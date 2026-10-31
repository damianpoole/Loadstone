import { randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";

export const factKinds = [
  "skill",
  "quest",
  "item",
  "unlock",
  "goal",
  "preference",
  "note",
] as const;
export type FactKind = (typeof factKinds)[number];
export type FactValue = string | number | boolean | { owned: boolean; quantity?: number };
export type Source = "user" | "runemetrics";
export interface Character {
  id: string;
  name: string;
  mode: string;
  createdAt: number;
}
export interface Fact {
  kind: FactKind;
  key: string;
  value: FactValue;
  source: Source;
  observedAt: number;
  recordedAt: number;
  evidence: string;
  operationId: string;
}
export interface Change {
  kind: FactKind;
  key: string;
  value: FactValue | null;
}
export interface Update {
  characterId: string;
  operationId: string;
  changes: Change[];
  source: Source;
  observedAt: number;
  evidence: string;
}
export interface Receipt {
  id: string;
  status: "saved" | "review" | "rejected";
  conflicts: string[];
  changes: { before: Fact | null; after: Fact | null; kind: FactKind; key: string }[];
}
export interface ChatSession {
  id: string;
  characterId: string;
  createdAt: number;
}
const canonical = (key: string) => key.trim().replace(/\s+/g, " ").toLowerCase();
const questRanks: Record<string, number> = { NOT_STARTED: 0, STARTED: 1, COMPLETED: 2 };
const skills = new Set(
  "Attack Defence Strength Constitution Ranged Prayer Magic Cooking Woodcutting Fletching Fishing Firemaking Crafting Smithing Mining Herblore Agility Thieving Slayer Farming Runecrafting Hunter Construction Summoning Dungeoneering Divination Invention Archaeology Necromancy"
    .toLowerCase()
    .split(" "),
);

export function validateChange(change: Change): void {
  if (!factKinds.includes(change.kind) || !change.key.trim() || change.key.length > 160)
    throw new Error("Invalid memory kind or key (maximum 160 characters).");
  const value = change.value;
  if (change.kind === "skill" && !skills.has(canonical(change.key)))
    throw new Error("Unknown RS3 skill.");
  if (value === null) return;
  switch (change.kind) {
    case "skill":
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 120)
        throw new Error("Skill level must be an integer from 1 to 120.");
      break;
    case "quest":
      if (typeof value !== "string" || !Object.hasOwn(questRanks, value))
        throw new Error("Quest status must be NOT_STARTED, STARTED, or COMPLETED.");
      break;
    case "unlock":
      if (typeof value !== "boolean") throw new Error("Unlock value must be true or false.");
      break;
    case "item":
      if (
        typeof value !== "object" ||
        typeof value.owned !== "boolean" ||
        Object.keys(value).some((k) => !["owned", "quantity"].includes(k)) ||
        (value.quantity !== undefined &&
          (!Number.isSafeInteger(value.quantity) ||
            value.quantity < 0 ||
            (value.owned ? value.quantity === 0 : value.quantity !== 0)))
      )
        throw new Error(
          "Item needs {owned: boolean, quantity?: nonnegative integer}; quantity must agree with ownership.",
        );
      break;
    case "goal":
      if (!["active", "completed", "paused"].includes(String(value)) || typeof value !== "string")
        throw new Error("Goal status must be active, completed, or paused.");
      break;
    default:
      if (typeof value !== "string" || !value.trim() || value.length > 4000)
        throw new Error("Notes/preferences must be nonempty text, at most 4000 characters.");
  }
}

/** Single-process local repository. The app holds a directory lock for its lifetime. */
export class MemoryStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
    );
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version as number;
    if (version > 1) {
      this.db.close();
      throw new Error("Memory database is newer than this app. Upgrade Loadstone.");
    }
    if (version === 0)
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, mode TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE facts (characterId TEXT NOT NULL REFERENCES characters(id), kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(characterId, kind, key));
      CREATE TABLE operations (id TEXT PRIMARY KEY, characterId TEXT NOT NULL REFERENCES characters(id), request TEXT NOT NULL, receipt TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX operation_character ON operations(characterId, createdAt);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, characterId TEXT NOT NULL REFERENCES characters(id), createdAt INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  }
  close() {
    this.db.close();
  }
  async backup(path: string) {
    await backup(this.db, path);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  createCharacter(name: string, mode = "ironman"): Character {
    name = name.trim().replace(/\s+/g, " ");
    if (!/^[a-zA-Z0-9 _-]{1,12}$/.test(name))
      throw new Error("RSN must be 1–12 letters, digits, spaces, underscores, or hyphens.");
    if (!["ironman", "hardcore", "group-ironman"].includes(mode))
      throw new Error("Mode must be ironman, hardcore, or group-ironman.");
    const existing = this.characters().find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const character = { id: randomUUID(), name, mode, createdAt: Date.now() };
    this.db
      .prepare("INSERT INTO characters VALUES (?, ?, ?, ?)")
      .run(character.id, name, mode, character.createdAt);
    return character;
  }
  characters(): Character[] {
    return this.db
      .prepare("SELECT * FROM characters ORDER BY createdAt, id")
      .all() as unknown as Character[];
  }
  character(id: string): Character {
    const character = this.characters().find((c) => c.id === id);
    if (!character) throw new Error("Character not found.");
    return character;
  }
  facts(characterId: string, query = "", kind?: FactKind): Fact[] {
    this.character(characterId);
    return this.db
      .prepare("SELECT data FROM facts WHERE characterId=? ORDER BY kind, key")
      .all(characterId)
      .map((row) => JSON.parse(row.data as string) as Fact)
      .filter(
        (f) =>
          (!kind || f.kind === kind) &&
          `${f.key} ${JSON.stringify(f.value)}`.toLowerCase().includes(query.toLowerCase()),
      );
  }
  private fact(characterId: string, kind: FactKind, key: string): Fact | null {
    const row = this.db
      .prepare("SELECT data FROM facts WHERE characterId=? AND kind=? AND key=?")
      .get(characterId, kind, canonical(key));
    return row ? (JSON.parse(row.data as string) as Fact) : null;
  }
  receipt(characterId: string, id: string): Receipt | undefined {
    const row = this.db
      .prepare("SELECT receipt FROM operations WHERE id=? AND characterId=?")
      .get(id, characterId);
    return row ? (JSON.parse(row.receipt as string) as Receipt) : undefined;
  }
  history(characterId: string, limit = 100): Receipt[] {
    return this.db
      .prepare(
        "SELECT receipt FROM operations WHERE characterId=? ORDER BY createdAt DESC, rowid DESC LIMIT ?",
      )
      .all(characterId, limit)
      .map((r) => JSON.parse(r.receipt as string) as Receipt);
  }
  pending(characterId: string): Receipt[] {
    return this.db
      .prepare(
        "SELECT receipt FROM operations WHERE characterId=? AND json_extract(receipt, '$.status')='review' ORDER BY rowid",
      )
      .all(characterId)
      .map((r) => JSON.parse(r.receipt as string) as Receipt);
  }
  apply(update: Update): Receipt {
    return this.transaction(() => this.applyInside(update));
  }
  private applyInside(update: Update, approved = false): Receipt {
    this.character(update.characterId);
    const prior = this.receipt(update.characterId, update.operationId);
    if (prior) return prior; // The durable task's receipt wins even after undo or later updates.
    if (
      !update.operationId ||
      !update.evidence.trim() ||
      update.evidence.length > 8000 ||
      !["user", "runemetrics"].includes(update.source) ||
      !Number.isFinite(update.observedAt) ||
      update.observedAt < 0 ||
      update.observedAt > Date.now() + 60_000
    )
      throw new Error("Invalid memory provenance.");
    if (!update.changes.length || update.changes.length > 1000)
      throw new Error("Expected 1–1000 memory changes.");
    const seen = new Set<string>();
    const conflicts: string[] = [];
    const changes = update.changes.map((change) => {
      validateChange(change);
      if (update.source === "runemetrics" && !["skill", "quest"].includes(change.kind))
        throw new Error("RuneMetrics only supplies skills and quests.");
      const key = canonical(change.key);
      const identity = `${change.kind}:${key}`;
      if (seen.has(identity)) throw new Error("Duplicate fact in update.");
      seen.add(identity);
      const before = this.fact(update.characterId, change.kind, key);
      if (change.value === null) conflicts.push(`${identity}: deletion needs confirmation`);
      if (before && change.value !== null) {
        if (update.observedAt < before.observedAt) conflicts.push(`${identity}: older observation`);
        const different = JSON.stringify(change.value) !== JSON.stringify(before.value);
        const regression =
          (change.kind === "skill" && Number(change.value) < Number(before.value)) ||
          (change.kind === "quest" &&
            questRanks[String(change.value)] < questRanks[String(before.value)]) ||
          (change.kind === "unlock" && before.value === true && change.value === false);
        if (regression) conflicts.push(`${identity}: progress would be lost`);
        if (
          different &&
          update.source === "runemetrics" &&
          before.source === "user" &&
          !(change.kind === "skill" && Number(change.value) > Number(before.value)) &&
          !(
            change.kind === "quest" &&
            questRanks[String(change.value)] > questRanks[String(before.value)]
          )
        )
          conflicts.push(`${identity}: contradicts user report`);
      }
      const after: Fact | null =
        change.value === null
          ? null
          : {
              kind: change.kind,
              key,
              value: change.value,
              source: update.source,
              observedAt: update.observedAt,
              recordedAt: Date.now(),
              evidence: update.evidence,
              operationId: update.operationId,
            };
      return { kind: change.kind, key, before, after };
    });
    const receipt: Receipt = {
      id: update.operationId,
      status: conflicts.length && !approved ? "review" : "saved",
      conflicts,
      changes,
    };
    if (receipt.status === "saved") this.writeFacts(update.characterId, changes);
    this.db
      .prepare("INSERT INTO operations VALUES (?, ?, ?, ?, ?)")
      .run(
        update.operationId,
        update.characterId,
        JSON.stringify(update),
        JSON.stringify(receipt),
        Date.now(),
      );
    return receipt;
  }
  private writeFacts(characterId: string, changes: Receipt["changes"]) {
    for (const change of changes) {
      if (change.after)
        this.db
          .prepare(
            "INSERT INTO facts VALUES (?, ?, ?, ?) ON CONFLICT(characterId, kind, key) DO UPDATE SET data=excluded.data",
          )
          .run(characterId, change.kind, change.key, JSON.stringify(change.after));
      else
        this.db
          .prepare("DELETE FROM facts WHERE characterId=? AND kind=? AND key=?")
          .run(characterId, change.kind, change.key);
    }
  }
  review(characterId: string, id: string, accept: boolean): Receipt {
    return this.transaction(() => {
      const receipt = this.receipt(characterId, id);
      if (!receipt || receipt.status !== "review") throw new Error("Pending update not found.");
      if (accept) {
        for (const change of receipt.changes)
          if (
            JSON.stringify(this.fact(characterId, change.kind, change.key)) !==
            JSON.stringify(change.before)
          )
            throw new Error(
              "Memory changed since this proposal. Reject it and make a fresh update.",
            );
        this.writeFacts(characterId, receipt.changes);
      }
      receipt.status = accept ? "saved" : "rejected";
      this.db
        .prepare("UPDATE operations SET receipt=? WHERE id=?")
        .run(JSON.stringify(receipt), id);
      return receipt;
    });
  }
  undo(characterId: string, id: string): Receipt {
    return this.transaction(() => {
      const receipt = this.receipt(characterId, id);
      if (!receipt || receipt.status !== "saved") throw new Error("Saved update not found.");
      for (const change of receipt.changes)
        if (
          JSON.stringify(this.fact(characterId, change.kind, change.key)) !==
          JSON.stringify(change.after)
        )
          throw new Error("A newer update affects these facts; undo that update first.");
      return this.applyInside(
        {
          characterId,
          operationId: randomUUID(),
          source: "user",
          observedAt: Date.now(),
          evidence: `User undid ${id}`,
          changes: receipt.changes.map((c) => ({
            kind: c.kind,
            key: c.key,
            value: c.before?.value ?? null,
          })),
        },
        true,
      );
    });
  }
  createSession(characterId: string): ChatSession {
    this.character(characterId);
    const session = { id: randomUUID(), characterId, createdAt: Date.now() };
    this.db
      .prepare("INSERT INTO sessions VALUES (?, ?, ?)")
      .run(session.id, characterId, session.createdAt);
    return session;
  }
  sessions(characterId: string): ChatSession[] {
    return this.db
      .prepare("SELECT * FROM sessions WHERE characterId=? ORDER BY createdAt DESC, rowid DESC")
      .all(characterId) as unknown as ChatSession[];
  }
  setting(key: string): string | undefined {
    return this.db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value as
      | string
      | undefined;
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  exportCharacter(characterId: string) {
    return {
      version: 1,
      exportedAt: Date.now(),
      character: this.character(characterId),
      facts: this.facts(characterId),
      history: this.history(characterId, 1_000_000),
    };
  }
}
