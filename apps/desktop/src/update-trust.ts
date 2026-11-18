import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { parse } from "yaml";

export const stableFeed = {
  provider: "github",
  owner: "damianpoole",
  repo: "Loadstone",
  private: false,
  channel: "latest",
} as const;

export function matchesStableFeed(contents: string, publisher?: string) {
  const config: unknown = parse(contents);
  return Boolean(
    config &&
    typeof config === "object" &&
    Object.entries(stableFeed).every(
      ([key, expected]) => Object.hasOwn(config, key) && Reflect.get(config, key) === expected,
    ) &&
    !("host" in config) &&
    !("protocol" in config) &&
    (!publisher ||
      ("publisherName" in config &&
        Array.isArray(config.publisherName) &&
        config.publisherName.length === 1 &&
        config.publisherName[0] === publisher)),
  );
}

export function validSHA512(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9+/]{86}==$/.test(value);
}

export async function verifyStagedInstaller(
  path: string,
  sha512: string,
  verifySigner: (path: string) => Promise<string | null>,
) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("base64") !== sha512 || (await verifySigner(path)) !== null)
    throw new Error("The staged installer does not match the trusted release.");
}
