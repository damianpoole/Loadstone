// Runs the real Electron renderer with isolated data and mocked provider transport.
// LOADSTONE_SMOKE_EXECUTABLE points at an unpacked/installed app to test packaging.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { _electron } from "playwright-core";
import electronPath from "electron";
import lockfile from "proper-lockfile";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagedPath =
  process.platform === "darwin"
    ? join(
        appDirectory,
        "release",
        process.arch === "arm64" ? "mac-arm64" : "mac",
        "Loadstone.app",
        "Contents",
        "MacOS",
        "Loadstone",
      )
    : process.platform === "linux"
      ? join(appDirectory, "release", "linux-unpacked", "loadstone-desktop")
      : join(appDirectory, "release", "win-unpacked", "Loadstone.exe");
const executable =
  process.env.LOADSTONE_SMOKE_EXECUTABLE ||
  (process.env.LOADSTONE_SMOKE_PACKAGED === "1" ? packagedPath : undefined);
const home = await mkdtemp(join(tmpdir(), "loadstone desktop smoke "));
const auth = join(home, "auth.json");
await writeFile(
  auth,
  JSON.stringify({ openai: { type: "api_key", key: "smoke-not-a-real-key" } }),
  { mode: 0o600 },
);
const env = {
  ...process.env,
  LOADSTONE_HOME: home,
  LOADSTONE_AUTH: "pi",
  LOADSTONE_PI_AUTH_PATH: auth,
  PI_CODING_AGENT_DIR: home,
  LOADSTONE_PROVIDER: "openai",
  LOADSTONE_MODEL: "gpt-4o-mini",
};
delete env.ELECTRON_RUN_AS_NODE;
let running;
const launch = async () => {
  const application = await _electron.launch({
    executablePath: executable || electronPath,
    args: [
      ...(executable ? [] : [appDirectory]),
      `--user-data-dir=${join(home, "desktop-profile")}`,
    ],
    cwd: home,
    env,
    timeout: 30000,
  });
  running = application;
  const page = await application.firstWindow();
  await page.getByRole("heading", { name: /Loadstone/ }).waitFor();
  return { application, page };
};
try {
  let { application, page } = await launch();
  const runtime = await application.evaluate(({ app }) => ({
    node: process.versions.node,
    electron: process.versions.electron,
    packaged: app.isPackaged,
  }));
  assert.ok(runtime.electron);
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    true,
    "startup window is visible",
  );
  if (executable) assert.equal(runtime.packaged, true);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("https://example.com");
        return false;
      } catch {
        return true;
      }
    }),
    true,
    "CSP blocks renderer network requests",
  );
  await page.evaluate(() => window.open("https://example.com"));
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    1,
  );
  await page.getByLabel("RuneScape name").fill("SmokeIron");
  await page.getByRole("button", { name: "Open character" }).click();
  await page.getByRole("heading", { name: "SmokeIron", exact: true }).waitFor();
  await page.getByRole("button", { name: "New conversation" }).waitFor({ state: "visible" });
  await page.waitForFunction(async () => {
    const state = await window.loadstone.snapshot();
    return Boolean(state.session && state.view.model && !state.processing);
  });
  const snapshot = await page.evaluate(() => window.loadstone.snapshot());
  assert.ok(snapshot.session?.id, "durable session opens using bundled pi SDK");
  assert.ok(snapshot.view.model, "model catalog loads from bundled resources");
  assert.equal(snapshot.view.model.provider, "openai");
  // Intercept Node's transport through the test debugger, not a production app
  // backdoor. Exercise the packaged SDK/parser, durable storage, IPC and UI.
  await application.evaluate(() => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== "https://api.openai.com/v1/responses")
        throw new Error("Unexpected smoke-test network request");
      const item = {
        id: "msg_smoke",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Hello from packaged Loadstone.", annotations: [] }],
      };
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (event) =>
            controller.enqueue(
              encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
            );
          send({ type: "response.created", response: { id: "resp_smoke", status: "in_progress" } });
          send({
            type: "response.output_item.added",
            output_index: 0,
            item: { ...item, content: [], status: "in_progress" },
          });
          send({
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            delta: "Hello from ",
          });
          setTimeout(() => {
            send({
              type: "response.output_text.delta",
              output_index: 0,
              content_index: 0,
              delta: "packaged Loadstone.",
            });
            send({ type: "response.output_item.done", output_index: 0, item });
            send({
              type: "response.completed",
              response: {
                id: "resp_smoke",
                status: "completed",
                output: [item],
                usage: {
                  input_tokens: 10,
                  output_tokens: 6,
                  total_tokens: 16,
                  input_tokens_details: { cached_tokens: 0 },
                },
              },
            });
            controller.close();
          }, 1000);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    };
  });
  await page.getByLabel("Message", { exact: true }).fill("Hello Loadstone");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".partial").getByText("Hello from", { exact: false }).waitFor();
  await page.getByText("Hello from packaged Loadstone.", { exact: true }).waitFor();
  await page.waitForFunction(async () => !(await window.loadstone.snapshot()).view.busy);
  assert.equal(await page.getByLabel("Message", { exact: true }).inputValue(), "");
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.loadstone.request({ type: "send", text: "/backup" });
        return false;
      } catch {
        return true;
      }
    }),
    true,
    "IPC refuses legacy slash commands",
  );
  await assert.rejects(lockfile.lock(home, { lockfilePath: join(home, ".tui.lock"), retries: 0 }), {
    code: "ELOCKED",
  });
  // Exercise the real window-close/before-quit lifecycle, not a forced process kill.
  const exited = once(application.process(), "exit", { signal: AbortSignal.timeout(30000) });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
  running = undefined;
  const database = new DatabaseSync(join(home, "memory.sqlite"));
  const fact = {
    kind: "skill",
    key: "herblore",
    value: 90,
    source: "user",
    observedAt: Date.now(),
    recordedAt: Date.now(),
    evidence: "Smoke test fixture",
    operationId: "smoke",
  };
  database
    .prepare("INSERT INTO facts VALUES (?, ?, ?, ?)")
    .run(snapshot.character.id, "skill", "herblore", JSON.stringify(fact));
  database.close();
  ({ application, page } = await launch());
  await page.getByRole("heading", { name: "SmokeIron", exact: true }).waitFor();
  await page.getByText("Smoke test fixture", { exact: true }).waitFor();
  await page.getByText("Hello from packaged Loadstone.", { exact: true }).waitFor();
  await page.getByText("Hello Loadstone", { exact: true }).waitFor();
  const restored = await page.evaluate(() => window.loadstone.snapshot());
  assert.equal(restored.session.id, snapshot.session.id);
  assert.equal(restored.facts[0].value, 90);
  await application.close();
  running = undefined;
  const release = await lockfile.lock(home, { lockfilePath: join(home, ".tui.lock"), retries: 0 });
  await release();
  console.log(
    "Desktop smoke passed:",
    runtime,
    "— isolated renderer, pi SDK, memory, session restoration, lock release",
  );
} finally {
  await running?.close();
  await rm(home, { recursive: true, force: true });
}
