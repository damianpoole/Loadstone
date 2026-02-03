import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CacheOptions {
  enabled?: boolean;
  ttlMs?: number;
  dir?: string;
}

export interface FetchJsonWithCacheOptions {
  cache?: CacheOptions;
  fetchOptions?: RequestInit;
  cacheKey?: string;
}

interface CacheEntry<T> {
  storedAt: number;
  body: T;
}

interface ResolvedCacheOptions {
  enabled: boolean;
  ttlMs: number;
  dir: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const parsePositiveNumber = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const resolveCacheOptions = (options?: CacheOptions): ResolvedCacheOptions => {
  const envTtlMs = parsePositiveNumber(process.env.LOADSTONE_CACHE_TTL_MS);
  const envTtlHours = parsePositiveNumber(
    process.env.LOADSTONE_CACHE_TTL_HOURS,
  );
  const envDir = process.env.LOADSTONE_CACHE_DIR;

  const ttlMs =
    options?.ttlMs ??
    envTtlMs ??
    (envTtlHours ? envTtlHours * 60 * 60 * 1000 : undefined) ??
    DEFAULT_TTL_MS;

  const dir =
    options?.dir ?? envDir ?? path.join(os.homedir(), ".loadstone", "cache");
  const enabled = options?.enabled ?? true;

  return {
    enabled,
    ttlMs,
    dir,
  };
};

const buildCacheKey = (
  url: string,
  fetchOptions?: RequestInit,
  cacheKey?: string,
): string => {
  if (cacheKey) return cacheKey;

  const method = fetchOptions?.method?.toUpperCase() ?? "GET";
  const body = fetchOptions?.body;
  let bodyKey = "";

  if (typeof body === "string") {
    bodyKey = body;
  } else if (body instanceof URLSearchParams) {
    bodyKey = body.toString();
  } else if (body instanceof ArrayBuffer) {
    bodyKey = Buffer.from(body).toString("base64");
  } else if (body != null) {
    try {
      bodyKey = JSON.stringify(body);
    } catch {
      bodyKey = String(body);
    }
  }

  return `${method}:${url}:${bodyKey}`;
};

const hashKey = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

const ensureCacheDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

const readCacheEntry = async <T>(
  filePath: string,
  ttlMs: number,
): Promise<T | null> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const entry = JSON.parse(raw) as CacheEntry<T>;

    if (!entry || typeof entry.storedAt !== "number") {
      await fs.rm(filePath, { force: true });
      return null;
    }

    const ageMs = Date.now() - entry.storedAt;
    if (ageMs > ttlMs) {
      await fs.rm(filePath, { force: true });
      return null;
    }

    return entry.body;
  } catch {
    return null;
  }
};

const writeCacheEntry = async <T>(filePath: string, body: T): Promise<void> => {
  const entry: CacheEntry<T> = {
    storedAt: Date.now(),
    body,
  };

  await fs.writeFile(filePath, JSON.stringify(entry), "utf8");
};

export const fetchJsonWithCache = async <T>(
  url: string,
  options: FetchJsonWithCacheOptions = {},
): Promise<T> => {
  const resolvedCache = resolveCacheOptions(options.cache);

  if (!resolvedCache.enabled) {
    const response = await fetch(url, options.fetchOptions);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  const cacheKey = buildCacheKey(url, options.fetchOptions, options.cacheKey);
  const cachePath = path.join(resolvedCache.dir, `${hashKey(cacheKey)}.json`);

  const cached = await readCacheEntry<T>(cachePath, resolvedCache.ttlMs);
  if (cached !== null) {
    return cached;
  }

  const response = await fetch(url, options.fetchOptions);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.statusText}`);
  }

  const data = (await response.json()) as T;

  try {
    await ensureCacheDir(resolvedCache.dir);
    await writeCacheEntry(cachePath, data);
  } catch {
    // Cache write failures should not block responses.
  }

  return data;
};
