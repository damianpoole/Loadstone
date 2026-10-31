import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompanionConnection, piAuthPaths } from "./auth";

describe("shared pi authentication", () => {
  let directory: string;
  const fetchMock = vi.fn<typeof fetch>();
  const oauth = {
    type: "oauth",
    access: "fixture-access",
    refresh: "fixture-refresh",
    expires: Date.now() + 3_600_000,
    clientId: "fixture-client",
    scopes: ["chatgpt.tokens.use.direct"],
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "loadstone-auth-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", directory);
    vi.stubEnv("LOADSTONE_PI_AUTH_PATH", "");
    vi.stubEnv("LOADSTONE_AUTH", "pi");
    for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"])
      vi.stubEnv(name, "");
    fetchMock.mockReset().mockRejectedValue(new Error("Unexpected network request"));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });
  async function credentials(value: unknown = { openai: oauth }) {
    await writeFile(join(directory, "auth.json"), JSON.stringify(value));
  }
  it("uses the SDK's stored OAuth and pi model preference without network access or copying credentials", async () => {
    await credentials();
    await writeFile(
      join(directory, "settings.json"),
      JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-5.5" }),
    );
    const before = await readFile(join(directory, "auth.json"), "utf8");
    const connection = await createCompanionConnection();
    expect(connection.defaultModel).toEqual({ provider: "openai", modelId: "gpt-5.5" });
    expect((await connection.models.getAuth("openai"))?.auth.apiKey).toBe(oauth.access);
    expect(connection.authSummary).toContain("OAuth (shared refresh)");
    expect(connection.authSummary).not.toContain(oauth.access);
    expect(connection.authSummary).not.toContain(oauth.refresh);
    expect(await readFile(join(directory, "auth.json"), "utf8")).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refreshes expired OAuth under the shared SDK lock and preserves other credentials", async () => {
    await credentials({
      openai: { ...oauth, expires: 0 },
      anthropic: { type: "api_key", key: "fixture-other-key" },
    });
    const first = await createCompanionConnection();
    const second = await createCompanionConnection();
    fetchMock.mockImplementation(async (url) => {
      expect(String(url)).toBe("https://auth.openai.com/api/accounts/oauth/token");
      return new Response(
        JSON.stringify({
          access_token: "fixture-new-access",
          refresh_token: "fixture-new-refresh",
          expires_in: 3600,
          scope: "chatgpt.tokens.use.direct",
        }),
        { status: 200 },
      );
    });
    const results = await Promise.all([
      first.models.getAuth("openai"),
      second.models.getAuth("openai"),
    ]);
    expect(results.map((r) => r?.auth.apiKey)).toEqual([
      "fixture-new-access",
      "fixture-new-access",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await readFile(join(directory, "auth.json"), "utf8"));
    expect(saved.openai.refresh).toBe("fixture-new-refresh");
    expect(saved.anthropic.key).toBe("fixture-other-key");
  });
  it("leaves credentials untouched when refresh fails", async () => {
    await credentials({ openai: { ...oauth, expires: 0 } });
    const before = await readFile(join(directory, "auth.json"), "utf8");
    const connection = await createCompanionConnection();
    fetchMock.mockResolvedValue(new Response("Invalid grant", { status: 401 }));
    await expect(connection.models.getAuth("openai")).rejects.toThrow();
    expect(await readFile(join(directory, "auth.json"), "utf8")).toBe(before);
  });
  it("prefers stored credentials to environment keys, with explicit environment-only opt-out", async () => {
    await credentials();
    vi.stubEnv("OPENAI_API_KEY", "fixture-env-key");
    const shared = await createCompanionConnection();
    expect((await shared.models.getAuth("openai"))?.auth.apiKey).toBe(oauth.access);
    vi.stubEnv("LOADSTONE_AUTH", "env");
    await writeFile(join(directory, "auth.json"), "invalid JSON fixture-secret");
    const env = await createCompanionConnection();
    expect((await env.models.getAuth("openai"))?.auth.apiKey).toBe("fixture-env-key");
    expect(env.defaultModel.modelId).toBe("gpt-4o-mini");
    expect(env.authSummary).toContain("Environment credentials only");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("handles no login without creating an auth store and honors explicit paths", async () => {
    const missing = await createCompanionConnection();
    expect(missing.authSummary).toContain("/login openai");
    expect(await missing.models.getAuth("openai")).toBeUndefined();
    await expect(readFile(join(directory, "auth.json"))).rejects.toThrow();
    const path = join(directory, "custom-auth.json");
    await writeFile(path, JSON.stringify({ openai: oauth }));
    vi.stubEnv("LOADSTONE_PI_AUTH_PATH", path);
    expect(piAuthPaths().authPath).toBe(path);
    const custom = await createCompanionConnection();
    expect((await custom.models.getAuth("openai"))?.auth.apiKey).toBe(oauth.access);
    expect(custom.defaultModel.modelId).not.toBe("gpt-4o-mini");
    vi.stubEnv("LOADSTONE_PI_AUTH_PATH", join(directory, "missing"));
    await expect(createCompanionConnection()).rejects.toThrow("does not exist");
  });
  it("reports malformed files without exposing their contents", async () => {
    await writeFile(join(directory, "auth.json"), "invalid fixture-secret");
    await expect(createCompanionConnection()).rejects.toThrow("Cannot read pi credentials");
    await credentials();
    await writeFile(join(directory, "settings.json"), "invalid fixture-secret");
    await expect(createCompanionConnection()).rejects.toThrow("Cannot read pi settings.json");
    vi.stubEnv("LOADSTONE_AUTH", "invalid");
    await expect(createCompanionConnection()).rejects.toThrow("must be pi or env");
  });
});
