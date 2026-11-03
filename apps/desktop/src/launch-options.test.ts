import { describe, expect, it } from "vite-plus/test";
import { displayError, launchEnvironment, linuxLaunchAdvice } from "./launch-options";

describe("desktop launcher", () => {
  it("removes Node-only Electron mode without changing the parent environment", () => {
    const original = { ELECTRON_RUN_AS_NODE: "1", DISPLAY: ":0", LOADSTONE_HOME: "/data" };
    expect(launchEnvironment(original)).toEqual({ DISPLAY: ":0", LOADSTONE_HOME: "/data" });
    expect(original.ELECTRON_RUN_AS_NODE).toBe("1");
  });
  it("requires a graphical Linux session, allowing both X11 and Wayland", () => {
    expect(displayError("linux", {})).toContain("No graphical Linux session");
    expect(displayError("linux", { DISPLAY: ":99" })).toBeUndefined();
    expect(displayError("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBeUndefined();
    expect(displayError("win32", {})).toBeUndefined();
    expect(displayError("darwin", {})).toBeUndefined();
  });
  it.each([
    "No usable sandbox!",
    "The SUID sandbox helper binary was found, but is not configured correctly",
    "Failed to move to new namespace: Operation not permitted",
  ])("explains sandbox failures without disabling it: %s", (message) => {
    expect(linuxLaunchAdvice(message)).toContain("sandbox setup");
    expect(linuxLaunchAdvice(message)).toContain("Do not run Loadstone as root");
  });
  it("distinguishes missing libraries and graphics failures", () => {
    expect(linuxLaunchAdvice("error while loading shared libraries: libnss3.so")).toContain(
      "system library",
    );
    expect(linuxLaunchAdvice("GPU process exited")).toContain("LOADSTONE_DISABLE_GPU=1");
  });
});
