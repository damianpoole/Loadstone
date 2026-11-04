import type { DesktopAuth, DesktopAuthState } from "@loadstone/agent";
import type { Character } from "@loadstone/memory";
import { Controller, type AppState } from "./controller";

export type DesktopRequest =
  | { type: "connection"; mode: "private" | "shared" | "offline" }
  | { type: "login"; provider: string; method: "api_key" | "oauth" }
  | { type: "answerLogin"; id: number; value: string }
  | { type: "logout"; provider: string }
  | { type: "cancelLogin" }
  | { type: "character"; name: string }
  | { type: "send"; text: string }
  | { type: "model"; provider: string; modelId: string }
  | { type: "sync" | "cancel" | "earlier" | "newSession" | "auth" };
export interface DesktopSnapshot extends AppState {
  characters: Character[];
  connection?: DesktopAuthState;
}
export interface DesktopAPI {
  snapshot(): Promise<DesktopSnapshot>;
  request(request: DesktopRequest): Promise<void>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
}

/** Validate IPC at the backend boundary, never trust TypeScript in the renderer. */
export function validateRequest(value: unknown): DesktopRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid desktop request.");
  const request = value as Record<string, unknown>;
  const text = (key: string, maximum: number) => {
    const field = request[key];
    if (typeof field !== "string" || !field.trim() || field.length > maximum)
      throw new Error(`Invalid ${key}.`);
    return field.trim();
  };
  switch (request.type) {
    case "connection":
      if (!["private", "shared", "offline"].includes(String(request.mode)))
        throw new Error("Invalid connection choice.");
      return { type: "connection", mode: request.mode as "private" | "shared" | "offline" };
    case "login":
      if (request.method !== "api_key" && request.method !== "oauth")
        throw new Error("Invalid login method.");
      return { type: "login", provider: text("provider", 100), method: request.method };
    case "logout":
      return { type: "logout", provider: text("provider", 100) };
    case "answerLogin":
      if (!Number.isSafeInteger(request.id)) throw new Error("Invalid login prompt.");
      return { type: "answerLogin", id: request.id as number, value: text("value", 16_000) };
    case "cancelLogin":
      return { type: "cancelLogin" };
    case "character": {
      const name = text("name", 12);
      if (!/^[a-zA-Z0-9 _-]+$/.test(name)) throw new Error("Invalid RuneScape name.");
      return { type: "character", name };
    }
    case "send": {
      const message = text("text", 32_000);
      // Never expose the legacy command interpreter (exports, paths, etc.) over IPC.
      if (message.startsWith("/"))
        throw new Error("Use desktop controls instead of slash commands.");
      return { type: "send", text: message };
    }
    case "model": {
      const provider = text("provider", 100);
      const modelId = text("modelId", 200);
      if (/\s/.test(provider + modelId))
        throw new Error("Model identifiers cannot contain spaces.");
      return { type: "model", provider, modelId };
    }
    case "sync":
    case "cancel":
    case "earlier":
    case "newSession":
    case "auth":
      return { type: request.type };
    default:
      throw new Error("Unsupported desktop request.");
  }
}

/** Typed desktop adapter; both clients use the same session and memory orchestration. */
export class DesktopService {
  constructor(
    readonly controller: Controller,
    readonly auth?: DesktopAuth,
  ) {}
  snapshot = (): DesktopSnapshot => ({
    ...this.controller.snapshot(),
    characters: this.controller.memory.characters(),
    connection: this.auth?.state,
  });
  subscribe(listener: (snapshot: DesktopSnapshot) => void) {
    const changed = () => listener(this.snapshot());
    const controller = this.controller.subscribe(changed);
    const auth = this.auth?.subscribe(changed);
    return () => {
      controller();
      auth?.();
    };
  }
  async request(value: unknown): Promise<void> {
    const request = validateRequest(value);
    if (this.auth) {
      if (request.type === "cancelLogin") return this.auth.cancel();
      if (request.type === "answerLogin") return this.auth.answer(request.id, request.value);
      if (["connection", "login", "logout"].includes(request.type)) {
        if (this.controller.state.processing || this.controller.state.view.busy)
          throw new Error("Cancel current work first.");
        try {
          if (request.type === "connection") {
            await this.auth.choose(request.mode);
            await this.controller.reconnect();
          }
          if (request.type === "login") await this.auth.login(request.provider, request.method);
          if (request.type === "logout") await this.auth.logout(request.provider);
        } catch {
          throw new Error(
            "Could not update connection. Cancel current work, check OS credential storage, and try again.",
          );
        }
        return;
      }
      if (
        request.type === "send" &&
        (this.auth.state.mode === "offline" ||
          this.auth.state.busy ||
          !this.auth.state.models.some(
            (model) =>
              model.provider === this.controller.state.view.model?.provider &&
              model.id === this.controller.state.view.model?.modelId,
          ))
      )
        throw new Error(
          "Connect a provider and choose a compatible model before sending. Your draft has been kept.",
        );
      if (
        request.type === "model" &&
        !this.auth.state.models.some(
          (model) => model.provider === request.provider && model.id === request.modelId,
        )
      )
        throw new Error("Choose a model from your connected providers.");
    }
    const execute = (command: string) => this.controller.execute(command, { throwOnError: true });
    switch (request.type) {
      case "connection":
      case "login":
      case "logout":
      case "answerLogin":
      case "cancelLogin":
        throw new Error("Graphical authentication is unavailable.");
      case "character":
        return execute(`/character ${request.name}`);
      case "send":
        return execute(request.text);
      case "model":
        return execute(`/model ${request.provider} ${request.modelId}`);
      case "cancel":
        return this.controller.cancel();
      case "newSession":
        return execute("/new");
      default:
        return execute(`/${request.type}`);
    }
  }
}
