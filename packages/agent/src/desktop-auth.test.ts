import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DesktopAuth, EncryptedCredentialStore, safeLoginURL } from "./desktop-auth";

const directories: string[] = [];
async function home() {
  const path = await mkdtemp(join(tmpdir(), "loadstone-auth-"));
  directories.push(path);
  return path;
}
const codec = {
  encrypt: (value: string) => Buffer.from(value).reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString(),
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("private desktop credentials", () => {
  it("encrypts at rest, serializes refresh and survives reopen/logout", async () => {
    const path = join(await home(), "credentials.enc");
    const store = new EncryptedCredentialStore(path, codec);
    await store.modify("openai", async () => ({
      type: "oauth",
      access: "secret-access",
      refresh: "rotating-0",
      expires: 0,
    }));
    await Promise.all(
      [1, 2, 3].map(() =>
        store.modify("openai", async (current) => {
          if (current?.type !== "oauth") throw new Error("Missing credential");
          await new Promise((resolve) => setTimeout(resolve, 2));
          return { ...current, refresh: `rotating-${Number(current.refresh.split("-")[1]) + 1}` };
        }),
      ),
    );
    expect((await readFile(path)).toString()).not.toContain("secret-access");
    const reopened = new EncryptedCredentialStore(path, codec);
    expect(await reopened.read("openai")).toMatchObject({ refresh: "rotating-3" });
    expect(await reopened.list()).toEqual([{ providerId: "openai", type: "oauth" }]);
    await reopened.delete("openai");
    expect(await store.list()).toEqual([]);
  });
  it("does not expose encrypted content or codec failures", async () => {
    const path = join(await home(), "credentials.enc");
    await new EncryptedCredentialStore(path, codec).modify("openai", async () => ({
      type: "api_key",
      key: "never-display",
    }));
    const broken = new EncryptedCredentialStore(path, {
      ...codec,
      decrypt: () => {
        throw new Error("never-display");
      },
    });
    await expect(broken.list()).rejects.toThrow("Cannot unlock private credentials");
  });
  it("starts offline without reading shared pi credentials and persists explicit choices", async () => {
    const path = await home();
    const auth = new DesktopAuth(path, codec, vi.fn());
    await auth.initialize();
    expect(auth.state.mode).toBe("offline");
    expect(auth.state.models).toEqual([]);
    await auth.choose("private");
    expect(auth.state.providers.some((p) => p.id === "openai")).toBe(true);
    await expect(auth.login("nonexistent", "oauth")).rejects.toThrow("Unsupported");
    const reopened = new DesktopAuth(path, codec, vi.fn());
    await reopened.initialize();
    expect(reopened.state.mode).toBe("private");
  });
  it("drives the pinned SDK API-key prompt without putting secrets in state", async () => {
    const path = await home();
    const auth = new DesktopAuth(path, codec, vi.fn());
    await auth.choose("private");
    const login = auth.login("openai", "api_key");
    await vi.waitFor(() => expect(auth.state.prompt).toBeDefined());
    const id = auth.state.prompt!.id;
    auth.answer(id, "test-secret-not-real");
    await login;
    expect(JSON.stringify(auth.state)).not.toContain("test-secret-not-real");
    expect(auth.state.providers.find((p) => p.id === "openai")?.connected).toBe(true);
    expect(auth.state.models.length).toBeGreaterThan(0);
    expect(() => auth.answer(id, "stale")).toThrow("expired");
    await auth.logout("openai");
    expect(auth.state.models).toEqual([]);
  });
  it("maps SDK browser/device and manual-code fallback without exposing the answer", async () => {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const browser = vi.fn().mockResolvedValue(undefined);
    const auth = new DesktopAuth(await home(), codec, browser);
    await auth.choose("private");
    vi.spyOn(ModelRuntime.prototype, "login").mockImplementation(
      async (_provider, _method, interaction) => {
        interaction.notify({
          type: "auth_url",
          url: "https://auth.openai.com/authorize?state=test",
        });
        interaction.notify({
          type: "device_code",
          userCode: "ABCD",
          verificationUri: "https://auth.openai.com/device",
        });
        const response = await interaction.prompt({
          type: "manual_code",
          message: "Paste callback",
        });
        expect(response).toBe("private-callback");
        throw new Error("revoked token private-callback");
      },
    );
    const login = auth.login("openai", "oauth");
    await vi.waitFor(() => expect(auth.state.prompt?.type).toBe("manual_code"));
    expect(browser).toHaveBeenCalledWith("https://auth.openai.com/device");
    auth.answer(auth.state.prompt!.id, "private-callback");
    await login;
    expect(auth.state.message).toContain("Connection failed");
    expect(JSON.stringify(auth.state)).not.toContain("private-callback");
    expect(auth.state.link).toBeUndefined();
  });
  it("blocks durable model transport while offline or disconnected", async () => {
    const auth = new DesktopAuth(await home(), codec, vi.fn());
    await auth.initialize();
    const connection = await auth.connection();
    const model = connection.models.getModels("openai")[0]!;
    expect(() => connection.models.streamSimple(model, { messages: [] })).toThrow("Reconnect");
    await auth.choose("private");
    const privateConnection = await auth.connection();
    expect(() => privateConnection.models.streamSimple(model, { messages: [] })).toThrow(
      "Reconnect",
    );
  });
  it("times out abandoned login and clears the secret prompt", async () => {
    const auth = new DesktopAuth(await home(), codec, vi.fn());
    await auth.choose("private");
    vi.useFakeTimers();
    try {
      const login = auth.login("openai", "api_key");
      await vi.advanceTimersByTimeAsync(0);
      expect(auth.state.prompt).toBeDefined();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await login;
      expect(auth.state.busy).toBe(false);
      expect(auth.state.prompt).toBeUndefined();
      expect(auth.state.message).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancels SDK prompts and permits reconnect", async () => {
    const auth = new DesktopAuth(await home(), codec, vi.fn());
    await auth.choose("private");
    const login = auth.login("openai", "api_key");
    await vi.waitFor(() => expect(auth.state.prompt).toBeDefined());
    await expect(auth.choose("shared")).rejects.toThrow("Cancel login");
    auth.cancel();
    await login;
    expect(auth.state.busy).toBe(false);
    expect(auth.state.prompt).toBeUndefined();
    expect(auth.state.message).toContain("cancelled");
    expect(auth.state.models).toEqual([]);
  });
});
it("restricts system-browser login URLs", () => {
  expect(safeLoginURL("https://auth.openai.com/authorize?state=example")).toBe(true);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://localhost",
    "https://secret@example.com",
    "not-a-url",
  ])
    expect(safeLoginURL(url)).toBe(false);
});
