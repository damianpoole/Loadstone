export function launchEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  // Editors/agent shells sometimes inherit this flag. It turns Electron into a
  // plain Node process, so no desktop window can ever be created.
  delete clean.ELECTRON_RUN_AS_NODE;
  return clean;
}

export function displayError(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY)
    return "No graphical Linux session was found (DISPLAY and WAYLAND_DISPLAY are unset). Run Loadstone from your desktop session, not a headless SSH/container shell.";
}

export function linuxLaunchAdvice(stderr: string): string {
  if (/sandbox|namespace|zygote_host_impl_linux/i.test(stderr))
    return "Electron could not initialize its Linux sandbox. Some distributions (including Ubuntu 24.04+) restrict unprivileged user namespaces. See docs/desktop.md#linux-launch-troubleshooting for sandbox setup. Do not run Loadstone as root or permanently disable the sandbox.";
  if (/error while loading shared libraries/i.test(stderr))
    return "A Linux system library required by Electron is missing. The library name is in the error above; install the matching distribution package. See docs/desktop.md#linux-launch-troubleshooting.";
  return "For a graphics/display failure, try LOADSTONE_DISABLE_GPU=1 pnpm run desktop or LOADSTONE_OZONE_PLATFORM=x11 pnpm run desktop from a graphical session. See docs/desktop.md#linux-launch-troubleshooting.";
}
