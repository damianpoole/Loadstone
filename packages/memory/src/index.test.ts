import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore, validateChange, type Change, type Update } from "./index";

describe("character memory", () => {
  let dir: string;
  let store: MemoryStore;
  let id: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loadstone-memory-"));
    store = new MemoryStore(join(dir, "memory.sqlite"));
    id = store.createCharacter("TestIron").id;
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const update = (
    characterId: string,
    operationId: string,
    changes: Change[],
    extra: Partial<Update> = {},
  ): Update => ({
    characterId,
    operationId,
    changes,
    source: "user",
    observedAt: Date.now(),
    evidence: "User reported progress",
    ...extra,
  });
  it("creates case-insensitive characters and isolates facts and sessions", () => {
    expect(store.createCharacter("testiron").id).toBe(id);
    const other = store.createCharacter("OtherIron", "hardcore").id;
    store.apply(update(id, "one", [{ kind: "skill", key: " Herblore ", value: 90 }]));
    expect(store.facts(id)[0]).toMatchObject({
      key: "herblore",
      value: 90,
      source: "user",
      operationId: "one",
    });
    expect(store.facts(other)).toEqual([]);
    expect(store.receipt(other, "one")).toBeUndefined();
    const session = store.createSession(id);
    expect(store.sessions(id)).toEqual([session]);
    expect(store.sessions(other)).toEqual([]);
    expect(() => store.review(other, "one", true)).toThrow();
  });
  it("persists facts, history, settings and sessions across reopen", () => {
    store.apply(update(id, "one", [{ kind: "quest", key: "Plague's End", value: "COMPLETED" }]));
    store.setSetting("activeCharacter", id);
    store.createSession(id);
    store.close();
    store = new MemoryStore(join(dir, "memory.sqlite"));
    expect(store.facts(id)[0].value).toBe("COMPLETED");
    expect(store.history(id)).toHaveLength(1);
    expect(store.setting("activeCharacter")).toBe(id);
    expect(store.sessions(id)).toHaveLength(1);
  });
  it("deduplicates a replay even after undo", () => {
    const request = update(id, "tool:1", [
      { kind: "item", key: "Abyssal whip", value: { owned: true } },
    ]);
    const receipt = store.apply(request);
    expect(store.apply(request)).toEqual(receipt);
    expect(store.history(id)).toHaveLength(1);
    store.undo(id, receipt.id);
    expect(store.facts(id)).toEqual([]);
    expect(store.apply(request)).toEqual(receipt);
    expect(store.facts(id)).toEqual([]);
  });
  it("restores exact snapshots so consecutive undos survive reopen and preserve replay receipts", () => {
    const a = update(id, "A", [{ kind: "skill", key: "Herblore", value: 90 }], {
      source: "runemetrics",
      observedAt: 1000,
      evidence: "Original RuneMetrics observation",
    });
    const b = update(id, "B", [{ kind: "skill", key: "Herblore", value: 91 }]);
    const first = store.apply(a);
    const original = store.facts(id);
    const second = store.apply(b);
    const undone = store.undo(id, "B");
    expect(store.facts(id)).toEqual(original);
    expect(undone).toMatchObject({
      undoOf: "B",
      status: "saved",
      changes: [{ before: second.changes[0].after, after: first.changes[0].after }],
    });
    expect(undone.id).not.toBe("B");
    expect(store.receipt(id, "B")).toEqual(second);
    store.close();
    store = new MemoryStore(join(dir, "memory.sqlite"));
    expect(store.history(id)[0]).toEqual(undone);
    expect(store.apply(b)).toEqual(second);
    expect(store.facts(id)).toEqual(original);
    store.undo(id, "A");
    expect(store.facts(id)).toEqual([]);
    expect(store.apply(a)).toEqual(first);
    expect(store.apply(b)).toEqual(second);
    expect(store.facts(id)).toEqual([]);
    expect(store.history(id)).toHaveLength(4);
  });
  it("restores deleted facts and allows undoing the undo without rewriting provenance", () => {
    const original = store.apply(update(id, "A", [{ kind: "skill", key: "Herblore", value: 90 }]));
    store.apply(update(id, "B", [{ kind: "skill", key: "Herblore", value: null }]));
    const deletion = store.review(id, "B", true);
    const restore = store.undo(id, "B");
    expect(store.facts(id)).toEqual([original.changes[0].after]);
    const redo = store.undo(id, restore.id);
    expect(redo.undoOf).toBe(restore.id);
    expect(store.facts(id)).toEqual([]);
    store.undo(id, redo.id);
    expect(store.facts(id)).toEqual([original.changes[0].after]);
    store.undo(id, "A");
    expect(store.facts(id)).toEqual([]);
    expect(store.receipt(id, "B")).toEqual(deletion);
  });
  it("still rejects undo over unrelated same-value writes and leaves entire batches untouched", () => {
    store.apply(
      update(id, "A", [
        { kind: "skill", key: "Herblore", value: 90 },
        { kind: "quest", key: "Druidic Ritual", value: "COMPLETED" },
      ]),
    );
    store.apply(update(id, "B", [{ kind: "quest", key: "Druidic Ritual", value: "COMPLETED" }]));
    const before = store.facts(id);
    const history = store.history(id);
    expect(() => store.undo(id, "A")).toThrow("newer update");
    expect(store.facts(id)).toEqual(before);
    expect(store.history(id)).toEqual(history);
    store.undo(id, "B");
    store.undo(id, "A");
    expect(store.facts(id)).toEqual([]);
  });
  it("rolls back an entire batch on invalid input", () => {
    expect(() =>
      store.apply(
        update(id, "bad", [
          { kind: "skill", key: "Herblore", value: 90 },
          { kind: "quest", key: "Quest", value: "MAYBE" },
        ]),
      ),
    ).toThrow();
    expect(store.facts(id)).toEqual([]);
    expect(store.history(id)).toEqual([]);
  });
  it("requires review for progress regressions and deletions", () => {
    store.apply(update(id, "one", [{ kind: "skill", key: "Herblore", value: 90 }]));
    const regression = store.apply(
      update(id, "two", [{ kind: "skill", key: "Herblore", value: 80 }], { source: "runemetrics" }),
    );
    expect(regression.status).toBe("review");
    expect(store.facts(id)[0].value).toBe(90);
    expect(store.pending(id)).toHaveLength(1);
    store.review(id, "two", false);
    expect(store.pending(id)).toEqual([]);
    const deletion = store.apply(
      update(id, "three", [{ kind: "skill", key: "Herblore", value: null }]),
    );
    expect(deletion.status).toBe("review");
    store.review(id, "three", true);
    expect(store.facts(id)).toEqual([]);
    store.undo(id, "three");
    expect(store.facts(id)[0].value).toBe(90);
  });
  it("will not approve a stale proposal or undo over newer changes", () => {
    store.apply(update(id, "one", [{ kind: "skill", key: "Herblore", value: 90 }]));
    store.apply(update(id, "two", [{ kind: "skill", key: "Herblore", value: 80 }]));
    store.apply(update(id, "three", [{ kind: "skill", key: "Herblore", value: 91 }]));
    expect(() => store.review(id, "two", true)).toThrow("changed");
    expect(() => store.undo(id, "one")).toThrow("newer");
  });
  it("retains stale observations for review rather than overwriting", () => {
    store.apply(update(id, "one", [{ kind: "skill", key: "Herblore", value: 90 }]));
    const result = store.apply(
      update(id, "two", [{ kind: "skill", key: "Herblore", value: 91 }], {
        observedAt: 1000,
        source: "runemetrics",
      }),
    );
    expect(result.status).toBe("review");
    expect(result.conflicts.join()).toContain("older observation");
  });
  it("accepts forward API progress but cannot reset quest/unlock progress silently", () => {
    store.apply(
      update(id, "one", [
        { kind: "quest", key: "Smoking Kills", value: "COMPLETED" },
        { kind: "unlock", key: "Prifddinas", value: true },
      ]),
    );
    expect(
      store.apply(
        update(id, "two", [{ kind: "quest", key: "Smoking Kills", value: "NOT_STARTED" }]),
      ).status,
    ).toBe("review");
    expect(
      store.apply(update(id, "three", [{ kind: "unlock", key: "Prifddinas", value: false }]))
        .status,
    ).toBe("review");
    expect(
      store.apply(
        update(id, "four", [{ kind: "skill", key: "Herblore", value: 91 }], {
          source: "runemetrics",
        }),
      ).status,
    ).toBe("saved");
  });
  it("rejects duplicate fact keys and forged provenance", () => {
    expect(() =>
      store.apply(
        update(id, "one", [
          { kind: "skill", key: "Herblore", value: 90 },
          { kind: "skill", key: "herblore", value: 91 },
        ]),
      ),
    ).toThrow("Duplicate");
    expect(() =>
      store.apply(
        update(id, "two", [{ kind: "item", key: "Whip", value: { owned: true } }], {
          source: "runemetrics",
        }),
      ),
    ).toThrow("only supplies");
    expect(() =>
      store.apply(
        update(id, "three", [{ kind: "note", key: "test", value: "test" }], {
          observedAt: Infinity,
        }),
      ),
    ).toThrow("provenance");
  });
  it("exports and backs up independently usable memory", async () => {
    store.apply(update(id, "one", [{ kind: "goal", key: "Unlock Invention", value: "active" }]));
    expect(store.exportCharacter(id)).toMatchObject({
      version: 1,
      character: { id },
      facts: [{ kind: "goal", value: "active" }],
    });
    await store.backup(join(dir, "backup.sqlite"));
    const backup = new MemoryStore(join(dir, "backup.sqlite"));
    try {
      expect(backup.facts(id)).toEqual(store.facts(id));
    } finally {
      backup.close();
    }
  });
  it("refuses newer schema versions", () => {
    const file = join(dir, "future.sqlite");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA user_version=99");
    db.close();
    expect(() => new MemoryStore(file)).toThrow("newer");
  });
  it.each([
    { kind: "skill", key: "Herblore", value: 121 },
    { kind: "skill", key: "Sailing", value: 50 },
    { kind: "item", key: "Whip", value: { owned: true, quantity: -1 } },
    { kind: "item", key: "Whip", value: { owned: false, quantity: 1 } },
    { kind: "unlock", key: "Test", value: "yes" },
    { kind: "note", key: "Test", value: "" },
    { kind: "goal", key: "Test", value: "maybe" },
  ])("validates fact values: %j", (change) => {
    expect(() => validateChange(change as Change)).toThrow();
  });
});
