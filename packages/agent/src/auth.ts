import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelRef } from "@earendil-works/pi-durable";

export interface CompanionConnection {
  models: Models;
  defaultModel: ModelRef;
  /** Metadata only. Never include resolved auth, keys, or tokens in UI state. */
  authSummary: string;
}
const apiDefault = { provider: "openai", modelId: "gpt-4o-mini" };
const expandPath = (path: string) =>
  resolve(path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
export function piAuthPaths(env: NodeJS.ProcessEnv = process.env) {
  const directory = expandPath(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
  return {
    authPath: expandPath(env.LOADSTONE_PI_AUTH_PATH || join(directory, "auth.json")),
    settingsPath: join(directory, "settings.json"),
  };
}
async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(
      "Cannot access pi credentials. Check file permissions or use LOADSTONE_AUTH=env.",
    );
  }
}
function environmentConnection(): CompanionConnection {
  const models = createModels();
  models.setProvider(openaiProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(openrouterProvider());
  return {
    models,
    defaultModel: apiDefault,
    authSummary:
      "Environment credentials only (OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY). No pi credentials are read.",
  };
}
async function piDefault(settingsPath: string, models: Models): Promise<ModelRef | undefined> {
  let settings: unknown;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // JSON parser errors may contain file contents: do not include their message.
    throw new Error(
      "Cannot read pi settings.json. Fix its JSON/permissions or use LOADSTONE_AUTH=env.",
    );
  }
  if (!settings || typeof settings !== "object") return undefined;
  const { defaultProvider, defaultModel } = settings as Record<string, unknown>;
  return typeof defaultProvider === "string" &&
    typeof defaultModel === "string" &&
    models.getModel(defaultProvider, defaultModel)
    ? { provider: defaultProvider, modelId: defaultModel }
    : undefined;
}
/** Reuse the SDK's file store, lock protocol and refresh implementation, not copied OAuth tokens. */
export async function createCompanionConnection(): Promise<CompanionConnection> {
  const mode = process.env.LOADSTONE_AUTH ?? "pi";
  if (mode === "env") return environmentConnection();
  if (mode !== "pi") throw new Error("LOADSTONE_AUTH must be pi or env.");
  const { authPath, settingsPath } = piAuthPaths();
  if (!(await exists(authPath))) {
    if (process.env.LOADSTONE_PI_AUTH_PATH)
      throw new Error(
        "LOADSTONE_PI_AUTH_PATH does not exist. Point it at pi's auth.json or use LOADSTONE_AUTH=env.",
      );
    const connection = environmentConnection();
    return {
      ...connection,
      authSummary: `No pi auth.json found at ${authPath}. Sign in with /login openai in pi and restart, or use environment credentials.`,
    };
  }
  // Public SDK API: no deep imports from pi internals, project discovery, extensions or coding tools.
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const models = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  let credentials;
  try {
    credentials = await models.listCredentials({ signal: AbortSignal.timeout(35_000) });
  } catch {
    throw new Error(
      "Cannot read pi credentials. Check auth.json JSON/permissions, sign in again in pi, or use LOADSTONE_AUTH=env.",
    );
  }
  const preferred = await piDefault(settingsPath, models);
  const oauthProvider =
    credentials.find((c) => c.providerId === "openai" && c.type === "oauth")?.providerId ??
    credentials.find((c) => c.providerId === "openai-codex" && c.type === "oauth")?.providerId;
  const oauthModel = oauthProvider
    ? (models.getModel(oauthProvider, "gpt-5.5") ??
      models.getModels(oauthProvider).find((m) => m.id.includes("codex")))
    : undefined;
  return {
    models,
    defaultModel:
      preferred ??
      (oauthModel ? { provider: oauthModel.provider, modelId: oauthModel.id } : apiDefault),
    authSummary: `Shared pi credentials: ${authPath}\n${credentials.map((c) => `${c.providerId}: ${c.type === "oauth" ? "OAuth (shared refresh)" : "stored API credential"}`).join("\n") || "No stored credentials."}\nStored credentials take precedence over environment keys. LOADSTONE_AUTH=env opts out. Tokens remain in pi's store; refresh may update that file.`,
  };
}
export async function createCompanionModels(): Promise<Models> {
  return (await createCompanionConnection()).models;
}
