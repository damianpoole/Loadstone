import type { Character } from "@loadstone/memory";
import { Controller, type AppState } from "./controller";

export type DesktopRequest =
  | { type: "character"; name: string }
  | { type: "send"; text: string }
  | { type: "model"; provider: string; modelId: string }
  | { type: "sync" | "cancel" | "earlier" | "newSession" | "auth" };
export interface DesktopSnapshot extends AppState {
  characters: Character[];
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
  constructor(readonly controller: Controller) {}
  snapshot = (): DesktopSnapshot => ({
    ...this.controller.snapshot(),
    characters: this.controller.memory.characters(),
  });
  subscribe(listener: (snapshot: DesktopSnapshot) => void) {
    return this.controller.subscribe(() => listener(this.snapshot()));
  }
  async request(value: unknown): Promise<void> {
    const request = validateRequest(value);
    const execute = (command: string) => this.controller.execute(command, { throwOnError: true });
    switch (request.type) {
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
