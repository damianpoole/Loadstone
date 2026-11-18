import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applySqliteMigrations,
  SQLITE_MIGRATIONS,
} from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { migrateSessionStorage, SESSION_SCHEMA_VERSION } from "@loadstone/agent";
import { MemoryStore, MEMORY_SCHEMA_VERSION } from "@loadstone/memory";
import { prepareStorage, StorageUpgradeError } from "./storage";

vi.mock("node:sqlite", async (importOriginal) => {
  const sqlite = await importOriginal<typeof import("node:sqlite")>();
  return { ...sqlite, backup: vi.fn(sqlite.backup) };
});
vi.mock("@loadstone/agent", async (importOriginal) => {
  const agent = await importOriginal<typeof import("@loadstone/agent")>();
  return { ...agent, migrateSessionStorage: vi.fn(agent.migrateSessionStorage) };
});

let home: string;
const memoryPath = () => join(home, "memory.sqlite");
const sessionPath = (name = "inactive") => join(home, "sessions", `${name}.sqlite`);
const backups = () => join(home, "backups");
const readRow = (path: string, query: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(query).get();
  } finally {
    db.close();
  }
};

async function legacySession(name = "inactive") {
  const path = sessionPath(name);
  const db = await openNodeSqliteDatabase(path);
  try {
    await applySqliteMigrations(db, SQLITE_MIGRATIONS.slice(0, 1));
  } finally {
    await db.close();
  }
  return path;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "loadstone upgrade "));
  await mkdir(join(home, "sessions"));
});
afterEach(async () => {
  vi.mocked(backup).mockReset();
  vi.mocked(migrateSessionStorage).mockReset();
  await rm(home, { recursive: true, force: true });
});

describe("shared storage preflight", () => {
  it("takes no backup on a new or already-compatible home", async () => {
    expect(await prepareStorage(home)).toBeUndefined();
    new MemoryStore(memoryPath()).close();
    await migrateSessionStorage(sessionPath());
    expect(await prepareStorage(home)).toBeUndefined();
    expect(await readdir(home)).not.toContain("backups");
  });

  it("snapshots both databases including committed crash-WAL pages, migrates, and leaves a restorable recovery point", async () => {
    const mem = new MemoryStore(memoryPath());
    mem.createCharacter("SavedIron");
    mem.close();
    const session = await legacySession();
    await writeFile(join(home, "credentials.enc"), "private fixture");
    // A subprocess exits without SQLite closing: committed data is still in WAL,
    // and the interrupted transaction must not be included in either backup.
    execFileSync(process.execPath, [
      "-e",
      `
      const { DatabaseSync } = require('node:sqlite');
      const memory = new DatabaseSync(process.argv[1]);
      memory.exec("PRAGMA journal_mode=WAL; ALTER TABLE sessions DROP COLUMN title; PRAGMA user_version=1; INSERT INTO settings VALUES ('committed','yes');");
      const session = new DatabaseSync(process.argv[2]);
      session.exec('PRAGMA journal_mode=WAL;');
      session.prepare('INSERT INTO entries VALUES (2,1,NULL,1,?)').run(JSON.stringify({ text: 'saved chat' }));
      session.exec('BEGIN;');
      session.prepare('INSERT INTO entries VALUES (3,1,NULL,2,?)').run(JSON.stringify({ text: 'not committed' }));
      process.exit(0);
    `,
      memoryPath(),
      session,
    ]);
    expect(await readdir(join(home, "sessions"))).toContain("inactive.sqlite-wal");
    const saved = await prepareStorage(home);
    if (!saved) throw new Error("Expected a pre-migration snapshot.");
    expect((await readdir(saved)).sort()).toEqual(["backup.json", "memory.sqlite", "sessions"]);
    expect(await readdir(join(saved, "sessions"))).toEqual(["inactive.sqlite"]);
    const oldMemory = join(saved, "memory.sqlite");
    const oldSession = join(saved, "sessions", "inactive.sqlite");
    expect(readRow(oldMemory, "PRAGMA user_version")?.user_version).toBe(1);
    expect(readRow(oldMemory, "SELECT name FROM characters")?.name).toBe("SavedIron");
    expect(readRow(oldMemory, "SELECT value FROM settings WHERE key='committed'")?.value).toBe(
      "yes",
    );
    expect(readRow(oldSession, "SELECT version FROM durable_schema")?.version).toBe(1);
    expect(readRow(oldSession, "SELECT count(*) AS n, record FROM entries")).toEqual({
      n: 1,
      record: '{"text":"saved chat"}',
    });
    expect(readRow(memoryPath(), "PRAGMA user_version")?.user_version).toBe(MEMORY_SCHEMA_VERSION);
    expect(readRow(session, "SELECT version FROM durable_schema")?.version).toBe(
      SESSION_SCHEMA_VERSION,
    );
    expect(readRow(session, "SELECT record FROM entries WHERE id=2")?.record).toBe(
      '{"text":"saved chat"}',
    );
    expect(await readFile(join(home, "credentials.enc"), "utf8")).toBe("private fixture");
    expect(await prepareStorage(home)).toBeUndefined();
  });

  it("refuses a newer inactive session before backing up or migrating any file", async () => {
    new MemoryStore(memoryPath()).close();
    const old = await legacySession("old");
    const newer = new DatabaseSync(await legacySession("newer"));
    newer.prepare("UPDATE durable_schema SET version=?").run(SESSION_SCHEMA_VERSION + 1);
    newer.close();
    await expect(prepareStorage(home)).rejects.toThrow("newer version");
    expect(readRow(old, "SELECT version FROM durable_schema")?.version).toBe(1);
    expect(await readdir(home)).not.toContain("backups");
  });

  it("refuses an incompatible memory version before touching legacy sessions", async () => {
    const old = await legacySession();
    const db = new DatabaseSync(memoryPath());
    db.exec(`PRAGMA user_version=${MEMORY_SCHEMA_VERSION + 1}`);
    db.close();
    await expect(prepareStorage(home)).rejects.toThrow(
      "memory database was written by a newer version",
    );
    expect(readRow(old, "SELECT version FROM durable_schema")?.version).toBe(1);
  });

  it("never migrates or publishes an incomplete snapshot if the second backup runs out of space", async () => {
    new MemoryStore(memoryPath()).close();
    const path = await legacySession();
    const real = (await vi.importActual<typeof import("node:sqlite")>("node:sqlite")).backup;
    vi.mocked(backup).mockImplementationOnce(real).mockRejectedValueOnce(new Error("SQLITE_FULL"));
    await expect(prepareStorage(home)).rejects.toThrow("No migrations were started");
    expect(await readdir(backups())).toEqual([]);
    expect(readRow(path, "SELECT version FROM durable_schema")?.version).toBe(1);
  });

  it.each(["active.sqlite", "inactive.sqlite"])(
    "rejects recovery missing %s instead of creating a blank session",
    async (omitted) => {
      new MemoryStore(memoryPath()).close();
      await legacySession(omitted === "active.sqlite" ? "inactive" : "active");
      await writeFile(
        join(home, "backup.json"),
        JSON.stringify({
          format: 1,
          databases: ["memory.sqlite", "sessions/active.sqlite", "sessions/inactive.sqlite"],
        }),
      );
      await expect(prepareStorage(home)).rejects.toThrow(
        `Incomplete recovery: missing sessions/${omitted}`,
      );
      expect(await readdir(home)).not.toContain("backups");
    },
  );

  it("rejects a partial restore without the matching character database", async () => {
    const path = await legacySession();
    await expect(prepareStorage(home)).rejects.toThrow("Restore the matching memory database");
    expect(readRow(path, "SELECT version FROM durable_schema")?.version).toBe(1);
    expect(await readdir(home)).not.toContain("memory.sqlite");
  });

  it("stops before publishing or migrating after ownership is lost during the snapshot", async () => {
    new MemoryStore(memoryPath()).close();
    const path = await legacySession();
    const actual = (await vi.importActual<typeof import("node:sqlite")>("node:sqlite")).backup;
    let owned = true;
    vi.mocked(backup)
      .mockImplementationOnce(actual)
      .mockImplementationOnce(async (...params) => {
        const count = await actual(...params);
        owned = false;
        return count;
      });
    await expect(
      prepareStorage(home, async () => {
        if (!owned) throw new StorageUpgradeError("Ownership lost");
      }),
    ).rejects.toThrow("Ownership lost");
    expect(await readdir(backups())).toEqual([]);
    expect(readRow(path, "SELECT version FROM durable_schema")?.version).toBe(1);
    expect(migrateSessionStorage).not.toHaveBeenCalled();
  });

  it("keeps the original snapshot through a failed multi-database upgrade and can retry", async () => {
    new MemoryStore(memoryPath()).close();
    const first = await legacySession("a");
    const second = await legacySession("b");
    const real = (await vi.importActual<typeof import("@loadstone/agent")>("@loadstone/agent"))
      .migrateSessionStorage;
    vi.mocked(migrateSessionStorage)
      .mockImplementationOnce(real)
      .mockRejectedValueOnce(new Error("interrupted"));
    await expect(prepareStorage(home)).rejects.toThrow("pre-upgrade backup is at");
    const [saved] = await readdir(backups());
    expect(
      readRow(join(backups(), saved, "sessions", "a.sqlite"), "SELECT version FROM durable_schema")
        ?.version,
    ).toBe(1);
    expect(readRow(first, "SELECT version FROM durable_schema")?.version).toBe(2);
    expect(readRow(second, "SELECT version FROM durable_schema")?.version).toBe(1);
    await prepareStorage(home);
    expect(readRow(second, "SELECT version FROM durable_schema")?.version).toBe(2);
    expect(await readdir(backups())).toContain(saved);
  });
});
