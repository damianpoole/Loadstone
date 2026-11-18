import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { migrateSessionStorage, SESSION_SCHEMA_VERSION } from "@loadstone/agent";
import { MemoryStore, MEMORY_SCHEMA_VERSION } from "@loadstone/memory";

type Database = { path: string; relativePath: string; kind: "memory" | "session" };
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const stat = (path: string) =>
  lstat(path).catch((error: unknown) => {
    if (!missing(error)) throw error;
  });

export class StorageUpgradeError extends Error {}

async function databases(home: string): Promise<Database[]> {
  const result: Database[] = [];
  const memory = join(home, "memory.sqlite");
  const existing = await stat(memory);
  if (existing) {
    if (!existing.isFile()) throw new StorageUpgradeError("memory.sqlite must be a regular file.");
    result.push({ path: memory, relativePath: "memory.sqlite", kind: "memory" });
  } else if (await stat(`${memory}-wal`)) {
    throw new StorageUpgradeError(
      "A memory WAL exists without its database. Keep the files and consult offline recovery.",
    );
  }
  const sessions = join(home, "sessions");
  const directory = await stat(sessions);
  if (!directory) return result;
  if (!directory.isDirectory())
    throw new StorageUpgradeError("sessions must be a regular directory.");
  const entries = await readdir(sessions, { withFileTypes: true });
  const files = new Set(entries.map(({ name }) => name));
  for (const entry of entries) {
    if (entry.name.endsWith(".sqlite-wal") && !files.has(entry.name.slice(0, -4)))
      throw new StorageUpgradeError(
        "A conversation WAL exists without its database. Keep the files and consult offline recovery.",
      );
    if (!entry.name.endsWith(".sqlite")) continue;
    if (!entry.isFile())
      throw new StorageUpgradeError("Conversation databases must be regular files.");
    result.push({
      path: join(sessions, entry.name),
      relativePath: `sessions/${entry.name}`,
      kind: "session",
    });
  }
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function schema({ path, kind }: Database): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // pi-durable 1.4 uses chord's durable_schema table, not PRAGMA user_version.
    const hasSessionSchema = db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='durable_schema'")
      .get();
    const version =
      kind === "memory"
        ? db.prepare("PRAGMA user_version").get()?.user_version
        : hasSessionSchema
          ? db.prepare("SELECT version FROM durable_schema WHERE singleton=1").get()?.version
          : 0;
    if (
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (version === 0 && db.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get())
    ) {
      throw new StorageUpgradeError(
        `Unrecognized ${kind} database format. Keep your data and use a compatible version of Loadstone.`,
      );
    }
    if (version > (kind === "memory" ? MEMORY_SCHEMA_VERSION : SESSION_SCHEMA_VERSION)) {
      throw new StorageUpgradeError(
        `The ${kind} database was written by a newer version. Update Loadstone; reinstalling an older app does not roll back your data.`,
      );
    }
    return version;
  } finally {
    db.close();
  }
}

async function sync(path: string, directory = false) {
  const file = await open(path, directory ? "r" : "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

async function snapshot(home: string, sources: Database[], reason: "manual" | "pre-migration") {
  const root = join(home, "backups");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const id = `${reason}-${randomUUID()}`;
  const staging = join(root, `.partial-${id}`);
  const destination = join(root, id);
  await mkdir(staging, { mode: 0o700 });
  try {
    await mkdir(join(staging, "sessions"), { mode: 0o700 });
    for (const source of sources) {
      const target = join(staging, source.relativePath);
      const db = new DatabaseSync(source.path, { readOnly: true });
      try {
        // Includes committed WAL pages even after an unclean shutdown.
        await backup(db, target);
      } finally {
        db.close();
      }
      const copy = new DatabaseSync(target);
      try {
        if (
          copy.prepare("PRAGMA journal_mode=DELETE").get()?.journal_mode !== "delete" ||
          copy.prepare("PRAGMA quick_check").get()?.quick_check !== "ok"
        )
          throw new Error("Backup database verification failed.");
      } finally {
        copy.close();
      }
      await sync(target);
    }
    const manifest = join(staging, "backup.json");
    await writeFile(
      manifest,
      JSON.stringify(
        {
          format: 1,
          reason,
          createdAt: new Date().toISOString(),
          databases: sources.map(({ relativePath }) => relativePath),
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    await sync(manifest);
    // Node doesn't expose a Windows directory flush. File data is flushed on both platforms.
    if (process.platform !== "win32") {
      await sync(join(staging, "sessions"), true);
      await sync(staging, true);
    }
    await rename(staging, destination);
    if (process.platform !== "win32") {
      await sync(root, true);
      await sync(home, true);
    }
    return destination;
  } catch (error) {
    // A crash can leave a .partial directory. Never treat it as a complete backup.
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Caller holds the shared home lock; no other Loadstone writer may run. */
export async function prepareStorage(home: string) {
  const sources = await databases(home);
  const outdated = sources.filter(
    (source) =>
      schema(source) < (source.kind === "memory" ? MEMORY_SCHEMA_VERSION : SESSION_SCHEMA_VERSION),
  );
  if (!outdated.length) return;
  let saved: string;
  try {
    saved = await snapshot(home, sources, "pre-migration");
  } catch {
    throw new StorageUpgradeError(
      "Could not complete the pre-upgrade backup. No migrations were started. Check free disk space and backup directory permissions, then retry.",
    );
  }
  try {
    // Migrate inactive sessions too, so a later session switch cannot silently
    // migrate historical data without the same all-database recovery point.
    for (const session of outdated.filter(({ kind }) => kind === "session")) {
      await migrateSessionStorage(session.path);
    }
    const memory = outdated.find(({ kind }) => kind === "memory");
    if (memory) new MemoryStore(memory.path).close();
    return saved;
  } catch {
    throw new StorageUpgradeError(
      `Storage upgrade stopped. The pre-upgrade backup is at ${saved}. Fix the cause and retry, or follow offline recovery with a compatible version.`,
    );
  }
}

/** Call with the home locked and the durable companion closed. */
export async function backupStorage(home: string) {
  return snapshot(home, await databases(home), "manual");
}
