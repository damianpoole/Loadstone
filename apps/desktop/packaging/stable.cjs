// This config is used only by the protected signed-candidate workflow. It never publishes.
const { execFile } = require("node:child_process");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { promisify } = require("node:util");
const { join } = require("node:path");
const { build, version } = require("../package.json");

function required(...names) {
  for (const name of names)
    if (!process.env[name]?.trim()) throw new Error(`Missing release setting: ${name}`);
}

const windows = process.platform === "win32" && process.arch === "x64";
const mac = process.platform === "darwin" && process.arch === "arm64";
if (!windows && !mac)
  throw new Error("Stable candidates require native Windows x64 or macOS arm64.");
if (!/^\d+\.\d+\.\d+$/.test(version) || process.env.LOADSTONE_RELEASE_VERSION !== version) {
  throw new Error("The requested stable version must match the desktop package version.");
}

const publisher = process.env.LOADSTONE_WINDOWS_PUBLISHER;
if (windows) {
  required(
    "LOADSTONE_WINDOWS_PUBLISHER",
    "LOADSTONE_SIGN_ENDPOINT",
    "LOADSTONE_SIGN_ACCOUNT",
    "LOADSTONE_SIGN_PROFILE",
    "AZURE_TENANT_ID",
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "LOADSTONE_SIGNTOOL",
    "LOADSTONE_SIGN_DLIB",
  );
  if (!publisher.startsWith("CN="))
    throw new Error("Set the exact Authenticode signing certificate Subject.");
} else {
  required(
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "LOADSTONE_APPLE_TEAM_ID",
  );
  if (!/^[A-Z0-9]{10}$/.test(process.env.LOADSTONE_APPLE_TEAM_ID))
    throw new Error("Set the expected Apple Developer Team ID.");
}

module.exports = {
  ...build,
  forceCodeSigning: true,
  artifactName: "${productName}-${version}-${arch}.${ext}",
  publish: {
    provider: "github",
    owner: "damianpoole",
    repo: "Loadstone",
    private: false,
    channel: "latest",
  },
  mac: {
    ...build.mac,
    hardenedRuntime: true,
    minimumSystemVersion: "14.0",
    entitlements: "packaging/entitlements.mac.plist",
    entitlementsInherit: "packaging/entitlements.mac.plist",
    notarize: true,
  },
  dmg: { sign: true, writeUpdateInfo: false }, // The updater downloads ZIP, not the DMG.
  nsis: {
    ...build.nsis,
    runAfterFinish: false,
    oneClick: true,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    packElevateHelper: false,
  },
  win: {
    ...build.win,
    ...(windows
      ? {
          signtoolOptions: {
            publisherName: [publisher],
            signingHashAlgorithms: ["sha256"],
            async sign({ path }) {
              const temp = await mkdtemp(join(tmpdir(), "loadstone-sign-"));
              try {
                const metadata = join(temp, "signing.json");
                await writeFile(
                  metadata,
                  JSON.stringify({
                    Endpoint: process.env.LOADSTONE_SIGN_ENDPOINT,
                    CodeSigningAccountName: process.env.LOADSTONE_SIGN_ACCOUNT,
                    CertificateProfileName: process.env.LOADSTONE_SIGN_PROFILE,
                  }),
                  { flag: "wx" },
                );
                await promisify(execFile)(process.env.LOADSTONE_SIGNTOOL, [
                  "sign",
                  "/fd",
                  "SHA256",
                  "/tr",
                  "http://timestamp.acs.microsoft.com",
                  "/td",
                  "SHA256",
                  "/dlib",
                  process.env.LOADSTONE_SIGN_DLIB,
                  "/dmdf",
                  metadata,
                  path,
                ]);
              } finally {
                await rm(temp, { recursive: true, force: true });
              }
            },
          },
        }
      : {}),
  },
  async afterPack({ appOutDir, packager }) {
    const resources = packager.getResourcesDir(appOutDir);
    await writeFile(
      join(resources, "loadstone-stable.json"),
      JSON.stringify({ version, ...(windows ? { publisher } : {}) }),
      { flag: "wx" },
    );
  },
};
