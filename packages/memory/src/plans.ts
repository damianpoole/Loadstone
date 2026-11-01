import type { Change, Fact, MemoryStore, Receipt, Update } from "./index";

/** Plans describe intended work, never evidence of achieved character progress. */
export interface PlanRequirement {
  kind: "skill" | "quest" | "item" | "unlock";
  key: string;
  /** Skill level or item quantity. Omit for quests/unlocks and unknown item quantities. */
  minimum?: number;
}
export interface PlanStep {
  id: string;
  title: string;
  parentId?: string;
  /** IDs must precede this step, making the persisted order a topological order. */
  dependsOn: string[];
  requirements: PlanRequirement[];
  sources: string[];
  notes: string;
}
export interface CharacterPlan {
  target: string;
  steps: PlanStep[];
}
const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
export const planGoalKey = (target: string, stepId?: string) =>
  stepId ? `${normalize(target)} / ${stepId}` : normalize(target);

export function parsePlan(value: unknown): CharacterPlan {
  const plan = (typeof value === "string" ? JSON.parse(value) : value) as CharacterPlan;
  const fail = () => {
    throw new Error(
      "Invalid plan: use a target (1–100 characters), 1–60 ordered steps, unique IDs, earlier parents/dependencies, and RS3 Wiki sources.",
    );
  };
  if (
    !plan ||
    typeof plan.target !== "string" ||
    !plan.target.trim() ||
    plan.target.length > 100 ||
    !Array.isArray(plan.steps) ||
    !plan.steps.length ||
    plan.steps.length > 60
  )
    fail();
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (
      !step ||
      typeof step.id !== "string" ||
      !/^[a-z0-9-]{1,40}$/.test(step.id) ||
      seen.has(step.id) ||
      typeof step.title !== "string" ||
      !step.title.trim() ||
      step.title.length > 160 ||
      typeof step.notes !== "string" ||
      step.notes.length > 1000 ||
      !Array.isArray(step.dependsOn) ||
      step.dependsOn.length > 60 ||
      step.dependsOn.some((id) => !seen.has(id)) ||
      (step.parentId !== undefined && !seen.has(step.parentId)) ||
      !Array.isArray(step.requirements) ||
      step.requirements.length > 30 ||
      !Array.isArray(step.sources) ||
      !step.sources.length ||
      step.sources.length > 8 ||
      step.sources.some(
        (url) =>
          typeof url !== "string" ||
          url.length > 500 ||
          !/^https:\/\/runescape\.wiki\/w\/[^\s]+$/.test(url),
      )
    )
      fail();
    for (const requirement of step.requirements) {
      if (
        !requirement ||
        !["skill", "quest", "item", "unlock"].includes(requirement.kind) ||
        typeof requirement.key !== "string" ||
        !requirement.key.trim() ||
        requirement.key.length > 160 ||
        (requirement.minimum !== undefined &&
          (!Number.isSafeInteger(requirement.minimum) || requirement.minimum < 1)) ||
        (requirement.kind === "skill" &&
          (requirement.minimum === undefined || requirement.minimum > 120)) ||
        (["quest", "unlock"].includes(requirement.kind) && requirement.minimum !== undefined)
      )
        fail();
    }
    seen.add(step.id);
  }
  // A parent's completion depends on its children; include those edges when detecting cycles.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) fail();
    if (visited.has(id)) return;
    visiting.add(id);
    const step = plan.steps.find((s) => s.id === id)!;
    for (const dependency of [
      ...step.dependsOn,
      ...plan.steps.filter((s) => s.parentId === id).map((s) => s.id),
    ])
      visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of plan.steps) visit(step.id);
  return plan;
}

export function requirementStatus(
  requirement: PlanRequirement,
  facts: Fact[],
): "satisfied" | "missing" | "unknown" {
  const fact = facts.find(
    (f) => f.kind === requirement.kind && normalize(f.key) === normalize(requirement.key),
  );
  if (!fact) return "unknown";
  switch (requirement.kind) {
    case "skill":
      return Number(fact.value) >= requirement.minimum! ? "satisfied" : "missing";
    case "quest":
      return fact.value === "COMPLETED" ? "satisfied" : "missing";
    case "unlock":
      return fact.value === true ? "satisfied" : "missing";
    case "item": {
      const value = fact.value;
      if (typeof value !== "object") return "unknown";
      if (!value.owned) return "missing";
      if (requirement.minimum === undefined) return "satisfied";
      return value.quantity === undefined
        ? "unknown"
        : value.quantity >= requirement.minimum
          ? "satisfied"
          : "missing";
    }
  }
}

/** One atomic, replay-safe receipt covers the plan and every goal; existing statuses are retained. */
export function savePlan(
  memory: MemoryStore,
  update: Omit<Update, "changes">,
  input: CharacterPlan,
): Receipt {
  const previous = memory.receipt(update.characterId, update.operationId);
  if (previous) return previous;
  const plan = parsePlan(input);
  const facts = memory.facts(update.characterId);
  const existing = facts.find((f) => f.kind === "plan" && f.key === normalize(plan.target));
  // Deliberately don't silently overwrite/reparent an existing plan or leave orphan subgoals.
  if (existing)
    throw new Error(
      "A plan for this target already exists. Review it with /goals; undo its creation before replacing it, or choose a distinct target.",
    );
  const changes: Change[] = [{ kind: "plan", key: plan.target, value: JSON.stringify(plan) }];
  for (const stepId of [undefined, ...plan.steps.map((s) => s.id)]) {
    const key = planGoalKey(plan.target, stepId);
    const goal = facts.find((f) => f.kind === "goal" && f.key === key);
    changes.push({ kind: "goal", key, value: goal?.value ?? "active" });
  }
  return memory.apply({ ...update, changes });
}

/** Computed from current facts on every read; never writes inferred achievements. */
export function planProgress(plan: CharacterPlan, facts: Fact[]) {
  const completed = new Map<string, boolean>();
  return plan.steps.map((step) => {
    const goalKey = planGoalKey(plan.target, step.id);
    const goal = facts.find((f) => f.kind === "goal" && f.key === goalKey);
    const requirements = step.requirements.map((r) => ({
      ...r,
      status: requirementStatus(r, facts),
    }));
    const children = plan.steps.filter((s) => s.parentId === step.id);
    const isComplete = (id: string): boolean => {
      const candidate = plan.steps.find((s) => s.id === id)!;
      const saved = facts.find((f) => f.kind === "goal" && f.key === planGoalKey(plan.target, id));
      if (saved?.value === "completed") return true;
      const nested = plan.steps.filter((s) => s.parentId === id);
      return (
        (candidate.requirements.length > 0 || nested.length > 0) &&
        candidate.requirements.every((r) => requirementStatus(r, facts) === "satisfied") &&
        nested.every((s) => isComplete(s.id))
      );
    };
    const done = isComplete(step.id);
    completed.set(step.id, done);
    const blockedBy = step.dependsOn.filter((id) => !completed.get(id));
    const status =
      goal?.value === "completed"
        ? "completed"
        : done
          ? "satisfied"
          : goal?.value === "paused"
            ? "paused"
            : blockedBy.length
              ? "blocked"
              : children.some((s) => !isComplete(s.id))
                ? "subgoals"
                : requirements.some((r) => r.status === "unknown")
                  ? "needs confirmation"
                  : "ready";
    return { ...step, goalKey, status, blockedBy, requirements };
  });
}

export function formatGoals(facts: Fact[], query = ""): string {
  const plans = facts.filter((f) => f.kind === "plan").map((f) => parsePlan(f.value));
  const linked = new Set(
    plans.flatMap((p) => [
      planGoalKey(p.target),
      ...p.steps.map((s) => planGoalKey(p.target, s.id)),
    ]),
  );
  const lines: string[] = [];
  for (const plan of plans) {
    if (!JSON.stringify(plan).toLowerCase().includes(query.toLowerCase())) continue;
    const root = facts.find((f) => f.kind === "goal" && f.key === planGoalKey(plan.target));
    lines.push(`${plan.target} [${root?.value ?? "goal removed"}]`);
    const progress = planProgress(plan, facts);
    const render = (parentId?: string, depth = 1) => {
      for (const step of progress.filter((s) => s.parentId === parentId)) {
        lines.push(
          `${"  ".repeat(depth)}${step.id}. ${step.title} [${step.status}]`,
          `${"  ".repeat(depth + 1)}Goal: ${step.goalKey}`,
        );
        if (step.blockedBy.length)
          lines.push(`${"  ".repeat(depth + 1)}After: ${step.blockedBy.join(", ")}`);
        for (const r of step.requirements)
          lines.push(
            `${"  ".repeat(depth + 1)}${r.kind}: ${r.key}${r.minimum ? ` ≥ ${r.minimum}` : ""} — ${r.status}`,
          );
        if (step.notes) lines.push(`${"  ".repeat(depth + 1)}${step.notes}`);
        lines.push(...step.sources.map((s) => `${"  ".repeat(depth + 1)}${s}`));
        render(step.id, depth + 1);
      }
    };
    render();
  }
  lines.push(
    ...facts
      .filter((f) => f.kind === "goal" && !linked.has(f.key) && f.key.includes(query.toLowerCase()))
      .map((f) => `${f.key} [${f.value}]`),
  );
  return lines.join("\n") || "No saved goals match.";
}
