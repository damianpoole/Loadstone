import { spawn } from "node:child_process";
import { resolve } from "node:path";
import electron from "electron";
import { displayError, launchEnvironment, linuxLaunchAdvice } from "./launch-options";

const env = launchEnvironment(process.env);
const problem = displayError(process.platform, env);
if (problem) {
  console.error(`[Loadstone] ${problem}`);
  process.exitCode = 1;
} else {
  console.log("[Loadstone] Build complete. Starting the desktop app…");
  // In ordinary Node the electron package exports its executable path; its
  // declarations describe the Electron-process API instead.
  const child = spawn(
    electron as unknown as string,
    [resolve(__dirname, ".."), ...process.argv.slice(2)],
    {
      env,
      stdio: ["inherit", "inherit", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    stderr = (stderr + chunk.toString()).slice(-16_000);
  });
  const interrupt = () => {
    child.kill("SIGINT");
  };
  const terminate = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  child.on("error", (error) => {
    console.error(`[Loadstone] Could not launch Electron: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("close", (code, signal) => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
    if (process.exitCode !== 0 && signal !== "SIGINT" && signal !== "SIGTERM") {
      console.error(`[Loadstone] Desktop exited before a normal shutdown (${signal ?? code}).`);
      if (process.platform === "linux") console.error(`[Loadstone] ${linuxLaunchAdvice(stderr)}`);
    }
  });
}
