import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { render } from "ink";
import lockfile from "proper-lockfile";
import { App } from "./app";
import { Controller, HELP } from "./controller";

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      `Loadstone Ironman companion\n\npnpm run tui\n\nConfiguration:\nLOADSTONE_HOME (default ~/.loadstone)\nLOADSTONE_PROVIDER (default openai)\nLOADSTONE_MODEL (default gpt-4o-mini)\nOPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY\n\n${HELP}`,
    );
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Loadstone TUI requires an interactive terminal. Use --help for setup or the existing loadstone CLI for JSON output.",
    );
  process.umask(0o077);
  const home = resolve(process.env.LOADSTONE_HOME ?? join(homedir(), ".loadstone"));
  await mkdir(home, { recursive: true, mode: 0o700 });
  // pi-durable requires exclusive ownership. A heartbeat lock recovers after crashes.
  const release = await lockfile.lock(home, {
    lockfilePath: join(home, ".tui.lock"),
    stale: 30_000,
    retries: 0,
  });
  let controller: Controller | undefined;
  let instance: ReturnType<typeof render> | undefined;
  let closing = false;
  let shutdown: Promise<void> | undefined;
  const quit = () => {
    if (closing) return;
    closing = true;
    shutdown = (async () => {
      try {
        await controller?.close();
      } catch (error) {
        process.exitCode = 1;
        controller?.report(error);
      } finally {
        instance?.unmount();
      }
    })();
  };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
  process.stdout.write("\u001b[?1049h");
  try {
    controller = new Controller(home);
    instance = render(<App controller={controller} onQuit={quit} />, {
      exitOnCtrlC: false,
      patchConsole: true,
    });
    await controller.initialize().catch((error) => controller?.report(error));
    await instance.waitUntilExit();
    await shutdown;
  } finally {
    process.off("SIGTERM", quit);
    process.off("SIGINT", quit);
    try {
      await controller?.close();
    } finally {
      process.stdout.write("\u001b[?1049l");
      await release();
    }
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
