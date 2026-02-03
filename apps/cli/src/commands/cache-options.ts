import type { CacheOptions } from "@loadstone/wiki-client";

export interface CacheCliOptions {
  cache?: boolean;
  cacheTtl?: string;
  cacheDir?: string;
}

const MS_PER_HOUR = 60 * 60 * 1000;

export const buildCacheOptions = (options: CacheCliOptions): CacheOptions => {
  const cacheOptions: CacheOptions = {};

  if (typeof options.cache === "boolean") {
    cacheOptions.enabled = options.cache;
  }

  if (options.cacheTtl) {
    const hours = Number(options.cacheTtl);
    if (Number.isFinite(hours) && hours > 0) {
      cacheOptions.ttlMs = hours * MS_PER_HOUR;
    }
  }

  if (options.cacheDir) {
    cacheOptions.dir = options.cacheDir;
  }

  return cacheOptions;
};
