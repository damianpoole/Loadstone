import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  MemoryStore,
  savePlan,
  parsePlan,
  planProgress,
  formatGoals,
  type CharacterPlan,
} from "./index";

const fixture = (): CharacterPlan => ({
  target: "Prifddinas",
  steps: [
    {
      id: "prepare",
      title: "Prepare for Plague's End",
      dependsOn: [],
      requirements: [],
      sources: ["https://runescape.wiki/w/Plague%27s_End"],
      notes: "Training group",
    },
    {
      id: "agility",
      title: "Train Agility to 75",
      parentId: "prepare",
      dependsOn: [],
      requirements: [{ kind: "skill", key: "Agility", minimum: 75 }],
      sources: ["https://runescape.wiki/w/Plague%27s_End"],
      notes: "Use an Ironman-friendly training method.",
    },
    {
      id: "quest",
      title: "Complete Plague's End",
      dependsOn: ["prepare"],
      requirements: [{ kind: "quest", key: "Plague's End" }],
      sources: ["https://runescape.wiki/w/Prifddinas"],
      notes: "Fixture only: not an exhaustive quest prerequisite list.",
    },
    {
      id: "enter",
      title: "Enter the city",
      dependsOn: ["quest"],
      requirements: [],
      sources: ["https://runescape.wiki/w/Prifddinas"],
      notes: "Mark this checklist step complete manually.",
    },
  ],
});
describe("character plans", () => {
  let memory: MemoryStore;
  let id: string;
  const request = (characterId: string, operationId = "plan") => ({
    characterId,
    operationId,
    source: "user" as const,
    observedAt: Date.now(),
    evidence: "/plan Prifddinas (generated advice)",
  });
  beforeEach(() => {
    memory = new MemoryStore(":memory:");
    id = memory.createCharacter("Iron").id;
  });
  afterEach(() => memory.close());
  it("atomically saves a root and nested goals without creating achieved facts; replay and undo are safe", () => {
    const receipt = savePlan(memory, request(id), fixture());
    expect(receipt.status).toBe("saved");
    expect(memory.facts(id, "", "goal")).toHaveLength(5);
    expect(memory.facts(id).every((f) => ["goal", "plan"].includes(f.kind))).toBe(true);
    expect(memory.exportCharacter(id).facts).toHaveLength(6);
    expect(memory.facts(memory.createCharacter("Other").id)).toEqual([]);
    memory.undo(id, receipt.id);
    expect(memory.facts(id)).toEqual([]);
    expect(savePlan(memory, request(id), fixture())).toEqual(receipt);
    expect(memory.facts(id)).toEqual([]);
  });
  it("keeps unknown distinct from missing, computes readiness and nested completion from current facts", () => {
    savePlan(memory, request(id), fixture());
    let progress = planProgress(fixture(), memory.facts(id));
    expect(progress.map((s) => s.status)).toEqual([
      "subgoals",
      "needs confirmation",
      "blocked",
      "blocked",
    ]);
    memory.apply({
      ...request(id, "skill"),
      changes: [{ kind: "skill", key: "Agility", value: 50 }],
    });
    expect(planProgress(fixture(), memory.facts(id))[1].status).toBe("ready");
    memory.apply({
      ...request(id, "progress"),
      changes: [
        { kind: "skill", key: "Agility", value: 75 },
        { kind: "quest", key: "Plague's End", value: "COMPLETED" },
      ],
    });
    progress = planProgress(fixture(), memory.facts(id));
    expect(progress.map((s) => s.status)).toEqual(["satisfied", "satisfied", "satisfied", "ready"]);
    expect(memory.facts(id, "", "goal").every((f) => f.value === "active")).toBe(true);
    memory.apply({
      ...request(id, "finish"),
      changes: [{ kind: "goal", key: "prifddinas / enter", value: "completed" }],
    });
    expect(planProgress(fixture(), memory.facts(id))[3].status).toBe("completed");
    const text = formatGoals(memory.facts(id));
    expect(text).toContain("    agility. Train Agility to 75 [satisfied]");
    expect(text).toContain("https://runescape.wiki/w/Prifddinas");
    expect(formatGoals(memory.facts(id), "unrelated")).toBe("No saved goals match.");
  });
  it("reviews the entire plan on a stale goal observation and refuses undo over newer subgoal edits", () => {
    memory.apply({
      ...request(id, "root"),
      observedAt: Date.now() + 1000,
      changes: [{ kind: "goal", key: "Prifddinas", value: "active" }],
    });
    const receipt = savePlan(memory, request(id), fixture());
    expect(receipt.status).toBe("review");
    expect(memory.facts(id)).toHaveLength(1);
    memory.review(id, receipt.id, true);
    expect(memory.facts(id)).toHaveLength(6);
    memory.apply({
      ...request(id, "edit"),
      changes: [{ kind: "goal", key: "prifddinas / enter", value: "completed" }],
    });
    expect(() => memory.undo(id, receipt.id)).toThrow("newer update");
    expect(memory.facts(id, "", "plan")).toHaveLength(1);
    memory.undo(id, "edit");
    memory.undo(id, receipt.id);
    expect(memory.facts(id)).toHaveLength(1);
  });
  it("retains existing goal statuses and refuses silent replacement", () => {
    memory.apply({
      ...request(id, "goal"),
      changes: [{ kind: "goal", key: "Prifddinas", value: "paused" }],
    });
    savePlan(memory, request(id), fixture());
    expect(memory.facts(id, "", "goal").find((f) => f.key === "prifddinas")?.value).toBe("paused");
    expect(() => savePlan(memory, request(id, "replace"), fixture())).toThrow("already exists");
    expect(memory.history(id)).toHaveLength(2);
  });
  it("validates prerequisites, ordering, hierarchy cycles, sources and skill names before any write", () => {
    const invalid: CharacterPlan[] = [];
    let plan = fixture();
    plan.steps[1].dependsOn = ["enter"];
    invalid.push(plan);
    plan = fixture();
    plan.steps[1].dependsOn = ["prepare"];
    invalid.push(plan); // parent depends on its own child
    plan = fixture();
    plan.steps[1].parentId = "nope";
    invalid.push(plan);
    plan = fixture();
    plan.steps[1].id = "prepare";
    invalid.push(plan);
    plan = fixture();
    plan.steps[0].sources = ["https://runescape.wiki.evil.test/w/Fake"];
    invalid.push(plan);
    plan = fixture();
    plan.steps[1].requirements[0].minimum = 121;
    invalid.push(plan);
    plan = fixture();
    plan.steps[1].requirements[0].key = "Sailing";
    invalid.push(plan);
    for (const input of invalid) expect(() => savePlan(memory, request(id), input)).toThrow();
    expect(() => parsePlan({ target: "x", steps: [null] })).toThrow();
    expect(memory.facts(id)).toEqual([]);
    expect(memory.history(id)).toEqual([]);
  });
  it("does not assume an unknown quantity or unknown unlock, and supports manual paused steps", () => {
    const plan = fixture();
    plan.steps[1].requirements = [
      { kind: "item", key: "Logs", minimum: 10 },
      { kind: "unlock", key: "Example" },
    ];
    memory.apply({
      ...request(id, "items"),
      changes: [
        { kind: "item", key: "Logs", value: { owned: true } },
        { kind: "goal", key: "prifddinas / enter", value: "paused" },
      ],
    });
    const progress = planProgress(plan, memory.facts(id));
    expect(progress[1].requirements.map((r) => r.status)).toEqual(["unknown", "unknown"]);
    expect(progress[3].status).toBe("paused");
  });
});
