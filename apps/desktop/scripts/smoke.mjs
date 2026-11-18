// Runs the real Electron renderer with isolated data and mocked provider transport.
// LOADSTONE_SMOKE_EXECUTABLE points at an unpacked/installed app to test packaging.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const launch = async (testHome = home) => {
  const application = await _electron.launch({
    executablePath: executable || electronPath,
    args: [
      ...(executable ? [] : [appDirectory]),
      `--user-data-dir=${join(testHome, "desktop-profile")}`,
    ],
    cwd: testHome,
    env: { ...env, LOADSTONE_HOME: testHome },
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
  if (executable) {
    assert.equal(runtime.packaged, true);
    const resources = await application.evaluate(() => process.resourcesPath);
    const notices = join(resources, "third-party-notices");
    assert.match(
      await readFile(join(notices, "main.cjs.NOTICES.txt"), "utf8"),
      /electron-updater@/,
    );
    const rendererNotices = await readdir(join(notices, "renderer", "assets"));
    assert.ok(rendererNotices.some((file) => file.endsWith(".NOTICES.txt")));
    const runtimeNotices = process.platform === "darwin" ? resources : dirname(executable);
    await readFile(join(runtimeNotices, "LICENSE.electron.txt"));
    await readFile(join(runtimeNotices, "LICENSES.chromium.html"));
    const expectsUpdates = process.env.LOADSTONE_SMOKE_EXPECT_UPDATES === "1";
    if (expectsUpdates) {
      assert.equal(
        await application.evaluate(async ({ Menu }) => {
          for (let i = 0; i < 40; i++) {
            const menu = Menu.getApplicationMenu()?.items.find(({ label }) => label === "Updates");
            if (menu?.submenu?.items[0].label === "Check for updates (GitHub)…") return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        }),
        true,
        "stable update menu is ready without a network request",
      );
      const requests = await application.evaluate(async ({ Menu, session }) => {
        // Block all update transport in its separate Electron session. This tests
        // the shipped GitHub provider and menu, not a mutable production feed.
        const transport = session.fromPartition("electron-updater", { cache: false });
        const urls = [];
        transport.webRequest.onBeforeRequest((details, callback) => {
          urls.push(details.url);
          callback({ cancel: true });
        });
        try {
          const item = () =>
            Menu.getApplicationMenu()?.items.find(({ label }) => label === "Updates")?.submenu
              ?.items[0];
          item().click();
          for (let i = 0; i < 100; i++) {
            if (item()?.label === "Update failed — check again") return urls;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("Expected the update failure menu to allow retry.");
        } finally {
          transport.webRequest.onBeforeRequest(null);
        }
      });
      assert.ok(requests.length);
      assert.ok(requests.every((url) => /^https:\/\/(api\.)?github\.com\//.test(url)));
    } else {
      await assert.rejects(readFile(join(resources, "loadstone-stable.json")), { code: "ENOENT" });
      await assert.rejects(readFile(join(resources, "app-update.yml")), { code: "ENOENT" });
    }
  }
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
  assert.equal(
    (await page.evaluate(() => window.loadstone.snapshot())).connection.mode,
    "offline",
    "first run does not silently reuse pi login",
  );
  // Exercise the actual graphical API-key interaction and native encryption.
  await page.getByLabel("Credential storage").selectOption("private");
  await page.getByLabel("Provider", { exact: true }).selectOption("openai");
  await page.getByRole("button", { name: "Connect API key", exact: true }).click();
  await page.locator("#login-answer").waitFor();
  await page.locator("#login-answer").fill("private-smoke-key-not-real");
  await page.getByRole("button", { name: "Continue login", exact: true }).click();
  await page.waitForFunction(async () => !(await window.loadstone.snapshot()).connection.busy);
  assert.equal(
    JSON.stringify(await page.evaluate(() => window.loadstone.snapshot())).includes(
      "private-smoke-key-not-real",
    ),
    false,
    "secret answers never enter snapshots",
  );
  const encryptionAvailable = await application.evaluate(
    ({ safeStorage }) =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  );
  if (encryptionAvailable) {
    assert.equal(
      (await readFile(join(home, "credentials.enc"))).includes(
        Buffer.from("private-smoke-key-not-real"),
      ),
      false,
      "native private store is encrypted",
    );
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.waitForFunction(
      async () =>
        !(await window.loadstone.snapshot()).connection.providers.some((p) => p.connected),
    );
  } else {
    assert.match(
      (await page.evaluate(() => window.loadstone.snapshot())).connection.message,
      /Connection failed/,
      "unavailable OS encryption fails closed",
    );
  }
  await page.getByLabel("Credential storage").selectOption("shared");
  await page.waitForFunction(async () =>
    (await window.loadstone.snapshot()).connection.providers.some(
      (p) => p.id === "openai" && p.connected,
    ),
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
  if (process.env.LOADSTONE_SMOKE_NSIS_PATH) {
    await assert.rejects(
      promisify(execFile)(process.env.LOADSTONE_SMOKE_NSIS_PATH, ["/S", "--updated"], {
        timeout: 25_000,
      }),
      { code: 2 },
      "NSIS refuses a live binary instead of terminating the app",
    );
    assert.equal(
      (await page.evaluate(() => window.loadstone.snapshot())).session.id,
      snapshot.session.id,
    );
  }
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
  // Simulate the preceding memory format alongside the real durable chat.
  database.exec("ALTER TABLE sessions DROP COLUMN title; PRAGMA user_version=1;");
  database.close();
  const credentials = await readFile(auth);
  ({ application, page } = await launch());
  await page.getByRole("heading", { name: "SmokeIron", exact: true }).waitFor();
  await page.getByText("Smoke test fixture", { exact: true }).waitFor();
  await page.getByText("Hello from packaged Loadstone.", { exact: true }).waitFor();
  await page
    .getByLabel("Conversation messages")
    .getByText("Hello Loadstone", { exact: true })
    .waitFor();
  const restored = await page.evaluate(() => window.loadstone.snapshot());
  assert.equal(restored.session.id, snapshot.session.id);
  assert.equal(restored.facts[0].value, 90);
  assert.equal(restored.connection.mode, "shared");
  assert.deepEqual(await readFile(auth), credentials);
  const [upgrade] = await readdir(join(home, "backups"));
  assert.match(upgrade, /^pre-migration-/);
  const backup = join(home, "backups", upgrade);
  assert.deepEqual((await readdir(backup)).sort(), ["backup.json", "memory.sqlite", "sessions"]);
  assert.deepEqual(await readdir(join(backup, "sessions")), [`${snapshot.session.id}.sqlite`]);
  const oldMemory = new DatabaseSync(join(backup, "memory.sqlite"), { readOnly: true });
  assert.equal(oldMemory.prepare("PRAGMA user_version").get().user_version, 1);
  oldMemory.close();
  // Browser clipboard access remains write-only; confirm the actual native clipboard changed.
  assert.equal(
    await page.evaluate(
      async () => (await navigator.permissions.query({ name: "clipboard-read" })).state,
    ),
    "denied",
  );
  const chat = page.getByLabel("Conversation messages");
  for (const message of ["Hello Loadstone", "Hello from packaged Loadstone."]) {
    await chat
      .getByRole("article")
      .filter({ has: page.getByText(message, { exact: true }) })
      .getByRole("button", { name: "Copy message", exact: true })
      .click();
    const copied = await application.evaluate(async ({ clipboard }, expected) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        if ((await clipboard.readText()) === expected) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }, message);
    assert.equal(copied, true, `Copy message should write ${message} to the clipboard`);
  }
  // Player-facing forms, not command strings: correction, review, undo and session resume.
  await page.getByRole("button", { name: "Correct herblore", exact: true }).click();
  await page.getByLabel("Correct herblore (JSON value)").fill("91");
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await page.waitForFunction(async () => (await window.loadstone.snapshot()).facts[0].value === 91);
  await page.getByText("Memory history", { exact: true }).click();
  await page.getByRole("button", { name: "Undo update…", exact: true }).click();
  await page.getByRole("button", { name: "Confirm undo", exact: true }).click();
  await page.waitForFunction(async () => (await window.loadstone.snapshot()).facts[0].value === 90);
  await page.getByRole("button", { name: "Correct herblore", exact: true }).click();
  await page.getByLabel("Correct herblore (JSON value)").fill("80");
  await page.getByRole("button", { name: "Save correction", exact: true }).click();
  await page.getByRole("button", { name: "Reject update", exact: true }).click();
  assert.equal((await page.evaluate(() => window.loadstone.snapshot())).facts[0].value, 90);
  const composer = page.getByLabel("Message", { exact: true });
  const newConversation = page.getByRole("button", { name: "New conversation", exact: true });
  const conversationSearch = page.getByLabel("Find conversation");
  const resume = page.getByRole("button", { name: "Resume conversation", exact: true });
  await composer.fill("/invalid draft for the original conversation");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Use desktop controls instead of slash commands." })
    .waitFor();
  assert.equal(await composer.inputValue(), "/invalid draft for the original conversation");
  await newConversation.click();
  await page.getByText(/Conversations \(2\)/).click();
  assert.equal(await composer.inputValue(), "");
  await composer.fill("Draft for the new conversation");
  await conversationSearch.fill("Hello Loadstone");
  await resume.click();
  await chat.getByText("Hello from packaged Loadstone.", { exact: true }).waitFor();
  assert.equal(await composer.inputValue(), "/invalid draft for the original conversation");
  await conversationSearch.fill("");
  await resume.click();
  await page.waitForFunction(
    () => document.querySelector("#message")?.value === "Draft for the new conversation",
  );
  await conversationSearch.fill("Hello Loadstone");
  await resume.click();
  await chat.getByText("Hello from packaged Loadstone.", { exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.loadstone.snapshot())).session.id,
    snapshot.session.id,
  );
  await page.getByLabel("Text size").selectOption("150");
  await page.getByText("Export and backup", { exact: true }).click();
  await page.getByRole("button", { name: "Export character JSON", exact: true }).click();
  await page.getByText(/Exported character facts and history to/).waitFor();
  await page.getByRole("button", { name: "Back up all characters and chats", exact: true }).click();
  await page.getByText(/Backup saved to/).waitFor();
  await page.reload();
  await page.getByText("Hello from packaged Loadstone.", { exact: true }).waitFor();
  await application.close();
  running = undefined;
  const release = await lockfile.lock(home, { lockfilePath: join(home, ".tui.lock"), retries: 0 });
  await release();

  // Follow the offline restore recipe, keeping the backup and original home intact.
  const recovery = join(home, "offline recovery");
  await mkdir(recovery);
  await cp(join(backup, "backup.json"), join(recovery, "backup.json"));
  await cp(join(backup, "memory.sqlite"), join(recovery, "memory.sqlite"));
  await cp(join(backup, "sessions"), join(recovery, "sessions"), { recursive: true });
  ({ application, page } = await launch(recovery));
  await page.getByRole("heading", { name: "SmokeIron", exact: true }).waitFor();
  await page.getByText("Hello from packaged Loadstone.", { exact: true }).waitFor();
  const recovered = await page.evaluate(() => window.loadstone.snapshot());
  assert.equal(recovered.connection.mode, "offline", "snapshot does not restore credentials");
  assert.equal(recovered.facts[0].value, 90);
  assert.equal(recovered.session.id, snapshot.session.id);
  await application.close();
  running = undefined;
  console.log(
    "Desktop smoke passed:",
    runtime,
    "— isolated renderer, legacy upgrade, offline restore, credentials, chat replay, lock release",
  );
} finally {
  await running?.close();
  await rm(home, { recursive: true, force: true });
}
