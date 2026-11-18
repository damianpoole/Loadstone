import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { matchesStableFeed, stableFeed, validSHA512, verifyStagedInstaller } from "./update-trust";

it("requires a canonical stable feed and an exact Windows publisher", () => {
  const publisher = "CN=Loadstone, O=Loadstone";
  const check = (value: unknown) => matchesStableFeed(JSON.stringify(value), publisher);
  expect(check({ ...stableFeed, publisherName: [publisher] })).toBe(true);
  expect(check(stableFeed)).toBe(false);
  expect(check({ ...stableFeed, publisherName: [publisher, "unknown"] })).toBe(false);
  expect(check({ ...stableFeed, publisherName: [publisher], host: "different.example" })).toBe(
    false,
  );
  expect(check({ ...stableFeed, publisherName: [publisher], channel: "preview" })).toBe(false);
  expect(matchesStableFeed(JSON.stringify(stableFeed))).toBe(true);
});

it("rechecks the exact installer hash and Windows signer, including a changed staged file", async () => {
  const home = await mkdtemp(join(tmpdir(), "loadstone update "));
  try {
    const path = join(home, "Loadstone Setup.exe");
    const original = "verified release";
    const sha512 = createHash("sha512").update(original).digest("base64");
    expect(validSHA512(sha512)).toBe(true);
    expect(validSHA512("malformed hash")).toBe(false);
    const signer = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
    await writeFile(path, original);
    await verifyStagedInstaller(path, sha512, signer);
    expect(signer).toHaveBeenCalledWith(path);
    await writeFile(path, "changed cache file");
    await expect(verifyStagedInstaller(path, sha512, signer)).rejects.toThrow("trusted release");
    await writeFile(path, original);
    signer.mockResolvedValue("unexpected publisher");
    await expect(verifyStagedInstaller(path, sha512, signer)).rejects.toThrow("trusted release");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
