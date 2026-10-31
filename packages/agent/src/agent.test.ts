import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  Harness,
  createRegistry,
  defineExtension,
  wrapTool,
  type Extension,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { MemoryStore } from "@loadstone/memory";
import * as wiki from "@loadstone/wiki-client";
import { characterExtension, applySnapshot, IRONMAN_PROMPT } from "./tools";
import { openCompanion, type AgentView, type Companion } from "./index";

vi.mock("@loadstone/wiki-client", () => ({
  searchWiki: vi.fn(),
  getPage: vi.fn(),
  getCategoryMembers: vi.fn(),
  getRSProfileSnapshot: vi.fn(),
}));
const save = (quote: string, key = "Herblore", value: number | string = 90, kind = "skill") =>
  fauxAssistantMessage(
    [
      fauxToolCall("update_character_memory", {
        evidenceQuote: quote,
        changes: [{ kind, key, value }],
      }),
    ],
    { stopReason: "toolUse" },
  );
const answer = (text = "Saved your progress.") => fauxAssistantMessage([fauxText(text)]);

describe("durable Ironman agent", () => {
  let dir: string;
  let memory: MemoryStore;
  let id: string;
  const closers: (() => Promise<void>)[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "loadstone-agent-"));
    memory = new MemoryStore(join(dir, "memory.sqlite"));
    id = memory.createCharacter("TestIron").id;
  });
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    memory.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function setup(extension?: Extension, path = join(dir, "session.sqlite")) {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    registry.install(extension ?? characterExtension(memory, id, "session"));
    const harness = await Harness.open(
      await openNodeSqliteStorage(path),
      { models, registry, settings: { retry: { enabled: false } } },
      ctx,
    );
    const root = await harness.root(ctx, {
      agent: { model: { provider: faux.getModel().provider, modelId: faux.getModel().id } },
    });
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        await harness.close(ctx);
      }
    };
    closers.push(close);
    return { faux, harness, root, close };
  }
  it("lets the model save factual progress through a scoped validated tool", async () => {
    const { faux, root } = await setup();
    faux.setResponses([save("I hit 90 Herblore"), answer()]);
    const result = await (
      await root.submit({ type: "input", content: "I hit 90 Herblore" }, ctx)
    ).wait(ctx);
    expect(result.status).toBe("done");
    expect(memory.facts(id)[0]).toMatchObject({
      kind: "skill",
      key: "herblore",
      value: 90,
      source: "user",
    });
    expect(memory.facts(id)[0].evidence).toContain("user entry");
    expect(memory.facts(memory.createCharacter("OtherIron").id)).toEqual([]);
  });
  it("rejects invented evidence and invalid facts without writing anything", async () => {
    const { faux, root } = await setup();
    faux.setResponses([
      save("I hit 90 Herblore"),
      save("Hello", "Herblore", 900),
      answer("I need a clear update."),
    ]);
    await (await root.submit({ type: "input", content: "Hello" }, ctx)).wait(ctx);
    expect(memory.facts(id)).toEqual([]);
    const transcript = await root.context(ctx);
    expect(transcript.messages.filter((m) => m.role === "toolResult" && m.isError)).toHaveLength(2);
  });
  it("keeps goals distinct from achieved unlocks and hypotheticals unsaved", async () => {
    const { faux, root } = await setup();
    faux.setResponses([
      save("I want to unlock Invention", "Unlock Invention", "active", "goal"),
      answer(),
      answer("That would open more training methods."),
    ]);
    await (
      await root.submit({ type: "input", content: "I want to unlock Invention" }, ctx)
    ).wait(ctx);
    await (
      await root.submit({ type: "input", content: "What if I had 90 Herblore?" }, ctx)
    ).wait(ctx);
    expect(memory.facts(id).map((f) => f.kind)).toEqual(["goal"]);
    expect(IRONMAN_PROMPT).toContain("NEVER save hypotheticals");
    // Scripted model contract test, not a claim of deterministic natural-language classification.
  });
  it("stores conflicts for UI approval and does not expose approval/shell tools", async () => {
    const extension = characterExtension(memory, id, "session");
    expect(extension.tools?.map((t) => t.name)).not.toContain("bash");
    expect(extension.tools?.map((t) => t.name)).not.toContain("approve_memory");
    const { faux, root } = await setup(extension);
    faux.setResponses([
      save("I hit 90 Herblore"),
      answer(),
      save("Actually 80 Herblore", "Herblore", 80),
      answer("Please review this correction."),
    ]);
    await (await root.submit({ type: "input", content: "I hit 90 Herblore" }, ctx)).wait(ctx);
    await (await root.submit({ type: "input", content: "Actually 80 Herblore" }, ctx)).wait(ctx);
    expect(memory.facts(id)[0].value).toBe(90);
    expect(memory.pending(id)).toHaveLength(1);
  });
  it("uses wiki tools as bounded reference data without writing character facts", async () => {
    vi.mocked(wiki.searchWiki).mockResolvedValue([
      { title: "Abyssal whip", url: "https://runescape.wiki/w/Abyssal_whip" },
    ]);
    vi.mocked(wiki.getPage).mockResolvedValue("x".repeat(17000));
    vi.mocked(wiki.getCategoryMembers).mockResolvedValue(["Abyssal whip"]);
    const { faux, root } = await setup();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("search_wiki", { query: "whip" }),
          fauxToolCall("get_wiki_page", { title: "Abyssal whip" }),
          fauxToolCall("get_category_members", { category: "Weapons" }),
        ],
        { stopReason: "toolUse" },
      ),
      answer("See https://runescape.wiki/w/Abyssal_whip"),
    ]);
    await (await root.submit({ type: "input", content: "Tell me about a whip" }, ctx)).wait(ctx);
    const messages = (await root.context(ctx)).messages;
    const page = messages.find((m) => m.role === "toolResult" && m.toolName === "get_wiki_page");
    expect(JSON.stringify(page)).toContain("nextOffset");
    expect(memory.facts(id)).toEqual([]);
  });
  it("exposes current memory/history and applies a fresh sync through the agent", async () => {
    vi.mocked(wiki.getRSProfileSnapshot).mockResolvedValue({
      username: "TestIron",
      observedAt: Date.now(),
      skills: { status: "available", data: { Herblore: 90 } },
      quests: { status: "unavailable", error: "private" },
    });
    const { faux, root } = await setup();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("sync_runemetrics", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage(
        [
          fauxToolCall("get_character_summary", {}),
          fauxToolCall("search_memory", { query: "herb", kind: "skill" }),
          fauxToolCall("get_memory_history", {}),
        ],
        { stopReason: "toolUse" },
      ),
      answer("Synced skills; quests are private."),
    ]);
    await (
      await root.submit({ type: "input", content: "Sync my progress and check memory" }, ctx)
    ).wait(ctx);
    expect(memory.facts(id)[0]).toMatchObject({ source: "runemetrics", value: 90 });
    expect(vi.mocked(wiki.getRSProfileSnapshot).mock.calls[0][0]).toBe("TestIron");
    const results = (await root.context(ctx)).messages.filter((m) => m.role === "toolResult");
    expect(results).toHaveLength(4);
    expect(results.every((m) => m.role === "toolResult" && !m.isError)).toBe(true);
  });
  it("terminates a runaway tool loop at the configured boundary", async () => {
    const { faux, root } = await setup();
    faux.setResponses(
      Array.from({ length: 12 }, () =>
        fauxAssistantMessage([fauxToolCall("get_character_summary", {})], {
          stopReason: "toolUse",
        }),
      ),
    );
    const result = await (
      await root.submit({ type: "input", content: "Check my progress" }, ctx)
    ).wait(ctx);
    expect(result.status).toBe("done");
    expect(faux.state.callCount).toBe(12);
    expect(JSON.stringify((await root.context(ctx)).messages)).toContain(
      "Tool-round limit reached",
    );
  });
  it("degrades partial sync without deleting quests and deduplicates sync snapshots", () => {
    memory.apply({
      characterId: id,
      operationId: "seed",
      changes: [{ kind: "quest", key: "Smoking Kills", value: "COMPLETED" }],
      source: "user",
      evidence: "completed",
      observedAt: Date.now(),
    });
    const snapshot: wiki.RSProfileSnapshot = {
      username: "TestIron",
      observedAt: Date.now(),
      skills: { status: "available", data: { Herblore: 90 } },
      quests: { status: "unavailable", error: "private" },
    };
    const result = applySnapshot(memory, id, "sync", snapshot);
    expect(result.warnings).toEqual(["quests: private"]);
    expect(memory.facts(id)).toHaveLength(2);
    applySnapshot(memory, id, "sync", snapshot);
    expect(memory.history(id)).toHaveLength(2);
    applySnapshot(memory, id, "empty", {
      ...snapshot,
      skills: { status: "available", data: {} },
      quests: { status: "available", data: [] },
    });
    expect(memory.facts(id)).toHaveLength(2);
  });
  it("resumes after memory committed but before the durable tool result, exactly once", async () => {
    const extension = characterExtension(memory, id, "session");
    const tool = extension.tools!.find((t) => t.name === "update_character_memory")!;
    let effectFinished = false;
    const interrupted = defineExtension({
      ...extension,
      wraps: [
        ...(extension.wraps ?? []),
        wrapTool(tool, (base) => ({
          ...base,
          execute: async (args, api, context) => {
            await base.execute(args, api, context);
            effectFinished = true;
            await new Promise<void>((_resolve, reject) => {
              const signal = context.abortSignal!;
              if (signal.aborted) reject(signal.reason);
              else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
            return {};
          },
        })),
      ],
    });
    const first = await setup(interrupted);
    first.faux.setResponses([save("I hit 90 Herblore")]);
    await first.root.submit(
      { type: "input", content: "I hit 90 Herblore", requestId: "request-1" },
      ctx,
    );
    await vi.waitFor(() => expect(effectFinished).toBe(true));
    await first.close();
    expect(memory.history(id)).toHaveLength(1);
    const second = await setup();
    second.faux.setResponses([answer("Progress recovered.")]);
    const settled = await (
      await second.root.submit(
        { type: "input", content: "I hit 90 Herblore", requestId: "request-1" },
        ctx,
      )
    ).wait(ctx);
    expect(settled.status).toBe("done");
    expect(memory.history(id)).toHaveLength(1);
    expect(memory.facts(id)[0].value).toBe(90);
  });
  it("streams through the public companion adapter, reopens history, and cancels", async () => {
    const faux = fauxProvider({ tokensPerSecond: 1000 });
    const models = createModels();
    models.setProvider(faux.provider);
    const views: AgentView[] = [];
    const options = {
      path: join(dir, "adapter.sqlite"),
      memory,
      characterId: id,
      sessionId: "adapter",
      models,
      model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
      onChange: (view: AgentView) => views.push(view),
    };
    let companion: Companion = await openCompanion(options);
    closers.push(async () => companion.close());
    faux.setResponses([answer("Hello Ironman")]);
    const submission = await companion.send("Hello");
    await submission.wait(ctx);
    await vi.waitFor(() =>
      expect(views.at(-1)?.messages.some((m) => m.text === "Hello Ironman")).toBe(true),
    );
    await companion.close();
    companion = await openCompanion(options);
    expect(views.at(-1)?.messages.some((m) => m.text === "Hello Ironman")).toBe(true);
    await companion.earlier();
    faux.setResponses([answer("Long answer ".repeat(1000))]);
    const pending = await companion.send("Explain more");
    await companion.cancel();
    expect((await pending.wait(ctx)).status).toBe("unanswered");
    await expect(companion.setModel({ provider: "missing", modelId: "missing" })).rejects.toThrow(
      "Unknown model",
    );
  });
});
