import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createModels, fauxProvider, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
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
    { type: "backup" },
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
