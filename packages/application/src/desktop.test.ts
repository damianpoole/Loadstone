import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { createCompanionConnection } from "@loadstone/agent";
import { Controller } from "./controller";
import { DesktopService, validateRequest } from "./desktop";

vi.mock("@loadstone/agent", async (original) => ({
  ...(await original<typeof import("@loadstone/agent")>()),
  createCompanionConnection: vi.fn(),
}));
const homes: string[] = [];
const controllers: Controller[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.close();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("desktop request boundary", () => {
  it.each([
    null,
    [],
    {},
    { type: "restore", path: "/tmp" },
    ...[
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://runescape.wiki/w/Test",
      "https://runescape.wiki.evil.test/",
      "https://evil.test@runescape.wiki/",
      "https://runescape.wiki:8443/",
    ].map((url) => ({ type: "openWiki", url })),
    { type: "character", name: "Iron", mode: "normal" },
    { type: "review", id: "seed", accept: "yes" },
    { type: "undo", id: "" },
    { type: "resume", id: "x".repeat(201) },
    { type: "plan", target: " " },
    { type: "plan", target: "x".repeat(101) },
    { type: "edit", change: null },
    { type: "edit", change: { kind: "skill", key: "Herblore", value: 121 } },
    { type: "edit", change: { kind: "quest", key: "Quest", value: true } },
    { type: "edit", change: { kind: "unlock", key: "Quest", value: {} } },
    { type: "edit", change: { kind: "item", key: "Whip", value: { owned: true, quantity: -1 } } },
    { type: "edit", change: { kind: "note", key: "a", value: "x".repeat(16001) } },
    { type: "connection", mode: "ambient" },
    { type: "login", provider: "openai", method: "password" },
    { type: "answerLogin", id: "1", value: "secret" },
    { type: "answerLogin", id: 1, value: "" },
    { type: "answerLogin", id: 1, value: "x".repeat(16001) },
    { type: "logout", provider: "" },
    { type: "send", text: "/backup" },
    { type: "send", text: " " },
    { type: "send", text: "a".repeat(32001) },
    { type: "character", name: "a\n/sync" },
    { type: "model", provider: "open ai", modelId: "model" },
  ])("rejects unsafe or malformed request %j", (request) => {
    expect(() => validateRequest(request)).toThrow();
  });
  it("returns only allow-listed values, not extra renderer fields", () => {
    expect(validateRequest({ type: "send", text: " Hello ", path: "/tmp" })).toEqual({
      type: "send",
      text: "Hello",
    });
    expect(
      validateRequest({ type: "login", provider: "openai", method: "oauth", key: "ignored" }),
    ).toEqual({ type: "login", provider: "openai", method: "oauth" });
    expect(
      validateRequest({ type: "answerLogin", id: 1, value: "response", url: "file:///etc/passwd" }),
    ).toEqual({ type: "answerLogin", id: 1, value: "response" });
    expect(validateRequest({ type: "openWiki", url: "https://runescape.wiki/w/Herblore" })).toEqual(
      { type: "openWiki", url: "https://runescape.wiki/w/Herblore" },
    );
    expect(validateRequest({ type: "character", name: "My Iron" })).toEqual({
      type: "character",
      name: "My Iron",
    });
  });
});

it("streams a real durable conversation and restores character, memory and history after reopening", async () => {
  const home = await mkdtemp(join(tmpdir(), "loadstone-desktop-"));
  homes.push(home);
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  vi.mocked(createCompanionConnection).mockResolvedValue({
    models,
    defaultModel: { provider: faux.getModel().provider, modelId: faux.getModel().id },
    authSummary: "Test credentials",
  });
  const controller = new Controller(home);
  controllers.push(controller);
  await controller.initialize();
  const desktop = new DesktopService(controller);
  const snapshots: ReturnType<DesktopService["snapshot"]>[] = [];
  const unsubscribe = desktop.subscribe((snapshot) => snapshots.push(snapshot));
  await expect(desktop.request({ type: "send", text: "Not selected yet" })).rejects.toThrow(
    "Select a character first",
  );
  await desktop.request({ type: "character", name: "TestIron" });
  controller.memory.apply({
    characterId: controller.state.character!.id,
    operationId: "seed",
    source: "user",
    observedAt: Date.now(),
    evidence: "Manually reported Herblore level",
    changes: [{ kind: "skill", key: "Herblore", value: 90 }],
  });
  faux.setResponses([fauxAssistantMessage([fauxText("Hello from your durable companion.")])]);
  await desktop.request({ type: "send", text: "Hello Loadstone" });
  await vi.waitFor(() => {
    expect(
      desktop
        .snapshot()
        .view.messages.some((message) => message.text === "Hello from your durable companion."),
    ).toBe(true);
    expect(desktop.snapshot().view.busy).toBe(false);
  });
  expect(snapshots.some((snapshot) => snapshot.view.busy)).toBe(true);
  const session = desktop.snapshot().session!.id;
  unsubscribe();
  const count = snapshots.length;
  await desktop.request({ type: "auth" });
  expect(snapshots).toHaveLength(count);
  await controller.close();
  controllers.splice(controllers.indexOf(controller), 1);
  const reopened = new Controller(home);
  controllers.push(reopened);
  await reopened.initialize();
  const restored = new DesktopService(reopened).snapshot();
  expect(restored.character?.name).toBe("TestIron");
  expect(restored.session?.id).toBe(session);
  expect(restored.facts[0]).toMatchObject({ kind: "skill", key: "herblore", value: 90 });
  expect(restored.view.messages.map((message) => message.text)).toContain(
    "Hello from your durable companion.",
  );
  expect(restored.view.messages.map((message) => message.text)).toContain("Hello Loadstone");
});

async function playerDesktop() {
  const home = await mkdtemp(join(tmpdir(), "loadstone-player-"));
  homes.push(home);
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const controller = new Controller(
    home,
    undefined,
    async () => ({
      models,
      defaultModel: { provider: faux.getModel().provider, modelId: faux.getModel().id },
      authSummary: "Test credentials",
    }),
    true,
  );
  controllers.push(controller);
  const desktop = new DesktopService(controller);
  await desktop.request({ type: "character", name: "Player", mode: "hardcore" });
  return { controller, desktop, home, faux };
}

it("corrects, reviews, rejects and undoes memory with provenance and persistent audit history", async () => {
  const { desktop, controller, home } = await playerDesktop();
  expect(desktop.snapshot().character?.mode).toBe("hardcore");
  const edit = (value: number | null) =>
    desktop.request({ type: "edit", change: { kind: "skill", key: "Herblore", value } });
  await edit(90);
  expect(desktop.snapshot().facts[0]).toMatchObject({
    value: 90,
    source: "user",
    evidence: "Explicit correction in desktop memory controls",
  });
  const saved = desktop.snapshot().history[0];
  await edit(80);
  expect(desktop.snapshot().facts[0].value).toBe(90);
  const proposal = desktop.snapshot().reviews[0];
  expect(proposal.changes[0]).toMatchObject({ before: { value: 90 }, after: { value: 80 } });
  await desktop.request({ type: "review", id: proposal.id, accept: false });
  expect(desktop.snapshot().reviews).toHaveLength(0);
  expect(desktop.snapshot().facts[0].value).toBe(90);
  await edit(null);
  const deletion = desktop.snapshot().reviews[0];
  await desktop.request({ type: "review", id: deletion.id, accept: true });
  expect(desktop.snapshot().facts).toHaveLength(0);
  await desktop.request({ type: "undo", id: deletion.id });
  expect(desktop.snapshot().facts[0]).toEqual(saved.changes[0].after);
  const id = desktop.snapshot().character!.id;
  await controller.close();
  const reopened = new Controller(home);
  controllers.push(reopened);
  expect(reopened.memory.facts(id)[0]).toEqual(saved.changes[0].after);
  expect(reopened.memory.history(id).some((receipt) => receipt.undoOf === deletion.id)).toBe(true);
});

it("renders automatic save receipts with desktop review guidance rather than terminal commands", async () => {
  const { desktop, faux } = await playerDesktop();
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("update_character_memory", {
          evidenceQuote: "Herblore is 90",
          changes: [{ kind: "skill", key: "Herblore", value: 90 }],
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage([fauxText("Saved your level.")]),
  ]);
  await desktop.request({ type: "send", text: "Herblore is 90" });
  await vi.waitFor(() => {
    expect(desktop.snapshot().view.busy).toBe(false);
    expect(desktop.snapshot().facts[0]?.value).toBe(90);
  });
  const receipt = desktop.snapshot().view.messages.find((message) => message.role === "Tool")?.text;
  expect(receipt).toContain("Saved automatically");
  expect(receipt).toContain("Memory history");
  expect(receipt).not.toContain("/undo");
  expect(desktop.snapshot().history[0].changes[0].after?.evidence).toContain("Herblore is 90");
});

it("validates browser destinations before invoking the native browser adapter", async () => {
  const { controller } = await playerDesktop();
  const open = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
  const desktop = new DesktopService(controller, undefined, open);
  await desktop.request({ type: "openWiki", url: "https://runescape.wiki/w/Test" });
  expect(open).toHaveBeenCalledExactlyOnceWith("https://runescape.wiki/w/Test");
  await expect(desktop.request({ type: "openWiki", url: "file:///tmp" })).rejects.toThrow();
  expect(open).toHaveBeenCalledTimes(1);
});

it("sends a graphical plan request and titles the current session", async () => {
  const { desktop, faux } = await playerDesktop();
  faux.setResponses([fauxAssistantMessage([fauxText("Plan advice.")])]);
  await desktop.request({ type: "plan", target: "Prifddinas" });
  expect(desktop.snapshot().session?.title).toContain("Prifddinas");
  await vi.waitFor(() => expect(desktop.snapshot().view.busy).toBe(false));
  expect(desktop.snapshot().view.messages.some((message) => message.text === "Plan advice.")).toBe(
    true,
  );
});

it("rejects stale approvals, conflicting undo and cross-character receipt/session access", async () => {
  const { desktop } = await playerDesktop();
  const change = { kind: "skill", key: "Herblore", value: 90 } as const;
  await desktop.request({ type: "edit", change });
  const first = desktop.snapshot().history[0];
  await desktop.request({ type: "edit", change: { ...change, value: 80 } });
  const proposal = desktop.snapshot().reviews[0];
  await desktop.request({ type: "edit", change: { ...change, value: 99 } });
  await expect(desktop.request({ type: "review", id: proposal.id, accept: true })).rejects.toThrow(
    "Memory changed",
  );
  await expect(desktop.request({ type: "undo", id: first.id })).rejects.toThrow("newer update");
  const session = desktop.snapshot().session!.id;
  await desktop.request({ type: "character", name: "Other" });
  await expect(desktop.request({ type: "resume", id: session })).rejects.toThrow(
    "Session not found",
  );
  await expect(desktop.request({ type: "review", id: proposal.id, accept: true })).rejects.toThrow(
    "not found",
  );
  await expect(desktop.request({ type: "undo", id: first.id })).rejects.toThrow("not found");
  expect(desktop.snapshot().facts).toHaveLength(0);
});

it("resumes sessions, preserves modes, exports full history and makes a reopenable backup", async () => {
  const { desktop, controller, home, faux } = await playerDesktop();
  const original = desktop.snapshot().session!.id;
  await desktop.request({ type: "newSession" });
  expect(desktop.snapshot().session?.id).not.toBe(original);
  await desktop.request({ type: "resume", id: original });
  expect(desktop.snapshot().session?.id).toBe(original);
  await desktop.request({ type: "character", name: "Player", mode: "group-ironman" });
  expect(desktop.snapshot().character?.mode).toBe("hardcore");
  await desktop.request({
    type: "edit",
    change: { kind: "goal", key: "Prifddinas", value: "active" },
  });
  expect(desktop.snapshot().goals).toContain("prifddinas");
  await desktop.request({ type: "export" });
  const exported = JSON.parse(
    await readFile(join(home, "exports", (await readdir(join(home, "exports")))[0]), "utf8"),
  );
  expect(exported.history).toHaveLength(1);
  expect(exported.facts[0]).toMatchObject({ kind: "goal", value: "active" });
  await desktop.request({ type: "backup" });
  const backup = join(home, "backups", (await readdir(join(home, "backups")))[0]);
  const restored = new Controller(backup);
  controllers.push(restored);
  expect(restored.memory.characters()).toEqual(controller.memory.characters());
  expect(restored.memory.facts(desktop.snapshot().character!.id)).toEqual(desktop.snapshot().facts);
  expect(await readdir(join(backup, "sessions"))).toContain(`${original}.sqlite`);
  faux.setResponses([fauxAssistantMessage([fauxText("Still connected after backup.")])]);
  await desktop.request({ type: "send", text: "Hello after backup" });
  await vi.waitFor(() =>
    expect(
      desktop
        .snapshot()
        .view.messages.some((message) => message.text === "Still connected after backup."),
    ).toBe(true),
  );
});
