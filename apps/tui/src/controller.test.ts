import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Controller } from "./controller";
import { syncCharacter, type Companion, type AgentView } from "@loadstone/agent";

vi.mock("@loadstone/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@loadstone/agent")>()),
  syncCharacter: vi.fn(),
}));
describe("TUI commands", () => {
  let home: string;
  let controller: Controller;
  const agent = {
    send: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
    earlier: vi.fn(),
    setModel: vi.fn(),
  };
  const open = vi.fn(async () => agent as unknown as Companion);
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("LOADSTONE_AUTH", "env");
    vi.stubEnv("LOADSTONE_PROVIDER", undefined);
    vi.stubEnv("LOADSTONE_MODEL", undefined);
    home = await mkdtemp(join(tmpdir(), "loadstone-tui-"));
    controller = new Controller(home, open);
    await controller.initialize();
  });
  afterEach(async () => {
    await controller.close();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });
  it("onboards, creates sessions, switches characters and restores the selection", async () => {
    await controller.execute("/character MyIron");
    const first = controller.state.session!;
    expect(controller.state.character?.name).toBe("MyIron");
    await controller.execute("/set skill Herblore = 90");
    await controller.execute("/new");
    expect(controller.state.session?.id).not.toBe(first.id);
    expect(controller.state.facts).toHaveLength(1);
    await controller.execute(`/resume ${first.id}`);
    expect(controller.state.session?.id).toBe(first.id);
    await controller.execute("/create hardcore OtherIron");
    expect(controller.state.facts).toEqual([]);
    expect(controller.state.character?.mode).toBe("hardcore");
    await controller.execute(`/resume ${first.id}`);
    expect(controller.state.notice).toContain("not found for this character");
    await controller.close();
    controller = new Controller(home, open);
    await controller.initialize();
    expect(controller.state.character?.name).toBe("OtherIron");
  });
  it("uses pi's model for new sessions and respects explicit overrides", async () => {
    vi.stubEnv("LOADSTONE_AUTH", "pi");
    vi.stubEnv("PI_CODING_AGENT_DIR", home);
    vi.stubEnv("LOADSTONE_PI_AUTH_PATH", "");
    await writeFile(join(home, "auth.json"), "{}");
    await writeFile(
      join(home, "settings.json"),
      JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5.5" }),
    );
    await controller.execute("/character MyIron");
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: { provider: "openai", modelId: "gpt-5.5" } }),
    );
    await controller.execute("/model openai gpt-4o-mini");
    await controller.execute("/new");
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: { provider: "openai", modelId: "gpt-4o-mini" } }),
    );
    vi.stubEnv("LOADSTONE_PROVIDER", "anthropic");
    vi.stubEnv("LOADSTONE_MODEL", "claude-sonnet-4-5");
    await controller.execute("/new");
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: { provider: "anthropic", modelId: "claude-sonnet-4-5" } }),
    );
    await controller.execute("/model pi");
    expect(agent.setModel).toHaveBeenLastCalledWith({ provider: "openai", modelId: "gpt-5.5" });
  });
  it("reports auth without a character and switches existing sessions to the connection default", async () => {
    await controller.execute("/auth");
    expect(controller.state.notice).toContain("Environment credentials only");
    await controller.execute("/character MyIron");
    await controller.execute("/model anthropic claude-sonnet-4-5");
    await controller.execute("/model pi");
    expect(agent.setModel).toHaveBeenLastCalledWith({ provider: "openai", modelId: "gpt-4o-mini" });
    expect(controller.memory.setting("model")).toBe("gpt-4o-mini");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ models: expect.any(Object) }));
  });
  it("supports memory review, rejection, corrections, undo and search", async () => {
    await controller.execute("/character MyIron");
    await controller.execute("/set skill Herblore = 90");
    await controller.execute("/set skill Herblore = 80");
    expect(controller.state.pending).toBe(1);
    const id = controller.memory.pending(controller.state.character!.id)[0].id;
    await controller.execute("/pending");
    expect(controller.state.notice).toContain(id);
    await controller.execute(`/reject ${id}`);
    expect(controller.state.pending).toBe(0);
    expect(controller.state.facts[0].value).toBe(90);
    await controller.execute("/forget skill Herblore");
    const deletion = controller.memory.pending(controller.state.character!.id)[0].id;
    await controller.execute(`/approve ${deletion}`);
    expect(controller.state.facts).toEqual([]);
    await controller.execute(`/undo ${deletion}`);
    expect(controller.state.facts[0].value).toBe(90);
    await controller.execute("/memory herb");
    expect(controller.state.notice).toContain("herblore");
    await controller.execute("/history");
    expect(controller.state.notice).toContain("User undid");
  });
  it("validates commands and forwards chat, model changes and cancellation", async () => {
    await controller.execute("Hello");
    expect(controller.state.notice).toContain("Select a character");
    await controller.execute("/character MyIron");
    await controller.execute("Hello");
    expect(agent.send).toHaveBeenCalledWith("Hello");
    await controller.execute("/model openai gpt-4o-mini");
    expect(agent.setModel).toHaveBeenCalledWith({ provider: "openai", modelId: "gpt-4o-mini" });
    await controller.execute("/retry");
    expect(agent.retry).toHaveBeenCalled();
    await controller.execute("/earlier");
    expect(agent.earlier).toHaveBeenCalled();
    await controller.cancel();
    expect(agent.cancel).toHaveBeenCalled();
    await controller.execute("/set skill Herblore = 999");
    expect(controller.state.notice).toContain("1 to 120");
    await controller.execute("/unknown");
    expect(controller.state.notice).toContain("Unknown command");
    await controller.execute("/help");
    expect(controller.state.notice).toContain("/backup");
  });
  it("syncs only the selected character and reports network errors", async () => {
    await controller.execute("/character MyIron");
    vi.mocked(syncCharacter).mockResolvedValueOnce({
      results: [],
      warnings: ["quests unavailable"],
    });
    await controller.execute("/sync");
    expect(controller.state.notice).toContain("quests unavailable");
    expect(vi.mocked(syncCharacter).mock.calls[0][1]).toBe(controller.state.character!.id);
    vi.mocked(syncCharacter).mockRejectedValueOnce(new Error("offline"));
    await controller.execute("/sync");
    expect(controller.state.notice).toBe("offline");
    expect(controller.state.processing).toBe(false);
  });
  it("exports private character JSON and creates a restorable all-session backup", async () => {
    await controller.execute("/character MyIron");
    await controller.execute('/set goal Unlock Invention = "active"');
    await controller.execute("/export");
    const file = (await readdir(join(home, "exports")))[0];
    expect(JSON.parse(await readFile(join(home, "exports", file), "utf8")).facts[0]).toMatchObject({
      kind: "goal",
      value: "active",
    });
    await mkdir(join(home, "sessions"), { recursive: true });
    await controller.execute("/backup");
    expect(controller.state.notice).toContain("Backup saved");
    const backup = (await readdir(join(home, "backups")))[0];
    expect(await readdir(join(home, "backups", backup))).toContain("memory.sqlite");
  });
  it("blocks state changes while the agent runs, but allows inspection and retry of parked work", async () => {
    await controller.execute("/character MyIron");
    controller.state = {
      ...controller.state,
      view: { ...controller.state.view, busy: true } as AgentView,
    };
    await controller.execute("/set skill Herblore = 90");
    expect(controller.state.notice).toContain("agent is working");
    expect(controller.state.facts).toEqual([]);
    await controller.execute("/memory");
    expect(controller.state.notice).toContain("No saved");
    await controller.execute("/retry");
    expect(agent.retry).toHaveBeenCalled();
  });
});
