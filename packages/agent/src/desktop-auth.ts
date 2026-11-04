import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Credential, CredentialStore, AuthPrompt, AuthEvent } from "@earendil-works/pi-ai";
import { piAuthPaths, type CompanionConnection } from "./auth";

export interface DesktopAuthState {
  mode: "private" | "shared" | "offline";
  busy: boolean;
  message: string;
  prompt?: {
    id: number;
    type: AuthPrompt["type"];
    message: string;
    options?: readonly { id: string; label: string }[];
  };
  link?: string;
  providers: { id: string; name: string; apiKey: boolean; oauth: boolean; connected: boolean }[];
  models: { provider: string; id: string; name: string; input: number; output: number }[];
}
export interface SecretCodec {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
/** The desktop's exclusive home lock protects this store across processes. Within
 * a process all reads, writes and SDK refresh callbacks are serialized together. */
export class EncryptedCredentialStore implements CredentialStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private path: string,
    private codec: SecretCodec,
  ) {}
  private transact<T>(fn: (data: Record<string, Credential>) => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      let data: Record<string, Credential> = {};
      try {
        data = JSON.parse(this.codec.decrypt(await readFile(this.path)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error(
            "Cannot unlock private credentials. Reconnect using the original OS account.",
          );
      }
      return fn(data);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  private async save(data: Record<string, Credential>) {
    await writeFile(`${this.path}.tmp`, this.codec.encrypt(JSON.stringify(data)), { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
  }
  read(provider: string) {
    return this.transact(async (data) => data[provider]);
  }
  list() {
    return this.transact(async (data) =>
      Object.entries(data).map(([providerId, value]) => ({ providerId, type: value.type })),
    );
  }
  modify(
    provider: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ) {
    return this.transact(async (data) => {
      const next = await fn(data[provider]);
      if (next) {
        data[provider] = next;
        await this.save(data);
      }
      return data[provider];
    });
  }
  delete(provider: string) {
    return this.transact(async (data) => {
      delete data[provider];
      await this.save(data);
    });
  }
}

export class DesktopAuth {
  state: DesktopAuthState = {
    mode: "offline",
    busy: false,
    message: "Connect a provider, explicitly reuse pi login, or continue without AI.",
    providers: [],
    models: [],
  };
  private runtime?: ModelRuntime;
  private abort?: AbortController;
  private loginSettled?: Promise<void>;
  private pending?: { id: number; resolve(value: string): void; reject(error: Error): void };
  private sequence = 0;
  private listeners = new Set<() => void>();
  constructor(
    private home: string,
    private codec: SecretCodec,
    private browser: (url: string) => Promise<void>,
  ) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(patch: Partial<DesktopAuthState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  async initialize() {
    let mode = "offline";
    try {
      mode = await readFile(join(this.home, "auth-mode"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Cannot read connection preferences.");
    }
    try {
      await this.choose(mode === "private" || mode === "shared" ? mode : "offline");
    } catch {
      await this.choose("offline");
      this.update({
        message:
          "Stored credentials could not be opened. Your character data is safe. Unlock your OS keychain or choose a store and reconnect.",
      });
    }
  }
  async choose(mode: DesktopAuthState["mode"]) {
    if (this.state.busy) throw new Error("Cancel login before changing credential storage.");
    this.update({ busy: true });
    try {
      const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
      const runtime = await ModelRuntime.create({
        ...(mode === "shared"
          ? { authPath: piAuthPaths().authPath }
          : {
              credentials: new EncryptedCredentialStore(
                join(this.home, "credentials.enc"),
                this.codec,
              ),
            }),
        modelsPath: null,
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      this.runtime = runtime;
      await writeFile(join(this.home, "auth-mode"), mode, { mode: 0o600 });
      this.update({ mode, prompt: undefined, link: undefined });
      await this.refresh();
    } finally {
      this.update({ busy: false });
    }
  }
  private async refresh() {
    const runtime = this.runtime!;
    const credentials = this.state.mode === "offline" ? [] : await runtime.listCredentials();
    const configured = new Set(credentials.map((c) => c.providerId));
    // Keep the initial supported surface deliberately small. No subscription claims.
    const providers = runtime
      .getProviders()
      .filter((p) => ["openai", "anthropic", "openrouter", "github-copilot"].includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        apiKey: !!p.auth?.apiKey?.login,
        oauth: !!p.auth?.oauth,
        connected: configured.has(p.id),
      }));
    const models = runtime
      .getModels()
      .filter((m) => configured.has(m.provider))
      .map((m) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
        input: m.cost.input,
        output: m.cost.output,
      }));
    this.update({
      providers,
      models,
      message:
        this.state.mode === "offline"
          ? "AI is off. Character memory and RuneMetrics sync remain available."
          : "Choose a model compatible with your account. Prices are estimates per million tokens; provider billing and eligibility apply.",
    });
  }
  async connection(): Promise<CompanionConnection> {
    if (!this.runtime) throw new Error("Connection settings are not ready.");
    const first = this.state.models[0];
    const runtime = this.runtime;
    // Durable recovery also passes through these methods. Offline/disconnected
    // sessions must never silently use ambient keys or resume paid requests.
    const guarded = new Set([
      "stream",
      "complete",
      "streamSimple",
      "completeSimple",
      "streamDeferred",
      "fetchDeferred",
      "generateImages",
      "classify",
    ]);
    const models = new Proxy(runtime, {
      get: (target, key) => {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (guarded.has(String(key)))
          return (...args: unknown[]) => {
            const model = args[0] as { provider?: string };
            if (
              this.state.mode === "offline" ||
              !this.state.providers.some((p) => p.id === model?.provider && p.connected)
            )
              throw new Error("Reconnect your provider in Connection settings before continuing.");
            return Reflect.apply(value, target, args);
          };
        return value.bind(target);
      },
    });
    return {
      models,
      defaultModel: first
        ? { provider: first.provider, modelId: first.id }
        : { provider: "openai", modelId: "gpt-4o-mini" },
      authSummary: this.state.message,
    };
  }
  async login(provider: string, method: "api_key" | "oauth") {
    if (this.state.busy || this.state.mode === "offline")
      throw new Error("Choose a credential store before connecting.");
    const supported = this.state.providers.find((p) => p.id === provider);
    if (!supported || !(method === "oauth" ? supported.oauth : supported.apiKey))
      throw new Error("Unsupported login method.");
    const abort = new AbortController();
    let settled!: () => void;
    this.loginSettled = new Promise<void>((resolve) => {
      settled = resolve;
    });
    this.abort = abort;
    const timer = setTimeout(() => abort.abort(), 5 * 60_000);
    this.update({ busy: true, message: "Connecting…", link: undefined });
    try {
      await this.runtime!.login(
        provider,
        method,
        {
          signal: abort.signal,
          prompt: (prompt) => this.prompt(prompt, abort.signal),
          notify: (event) => this.notify(event),
        },
        { agentName: "Loadstone" },
      );
      await this.refresh();
    } catch {
      // Provider errors can contain response bodies, tokens, pasted codes or keys.
      this.update({
        message: abort.signal.aborted
          ? "Login cancelled or timed out. You can try again."
          : "Connection failed. Check your account and try connecting again. No credentials are shown in logs.",
      });
    } finally {
      clearTimeout(timer);
      this.pending?.reject(new Error("Login finished."));
      this.pending = undefined;
      this.abort = undefined;
      this.update({ busy: false, prompt: undefined, link: undefined });
      settled();
      this.loginSettled = undefined;
    }
  }
  private prompt(prompt: AuthPrompt, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const cleanup = () => {
        signal.removeEventListener("abort", cancel);
        prompt.signal?.removeEventListener("abort", cancel);
        if (this.pending?.id === id) {
          this.pending = undefined;
          this.update({ prompt: undefined });
        }
      };
      const cancel = () => {
        cleanup();
        reject(new Error("Cancelled."));
      };
      if (signal.aborted || prompt.signal?.aborted) {
        cancel();
        return;
      }
      this.pending = {
        id,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      signal.addEventListener("abort", cancel, { once: true });
      prompt.signal?.addEventListener("abort", cancel, { once: true });
      this.update({
        prompt: {
          id,
          type: prompt.type,
          message: prompt.message,
          ...(prompt.type === "select"
            ? { options: prompt.options.map(({ id, label }) => ({ id, label })) }
            : {}),
        },
      });
    });
  }
  answer(id: number, value: string) {
    if (!this.pending || this.pending.id !== id || !value || value.length > 16_000)
      throw new Error("This login prompt has expired.");
    const options = this.state.prompt?.options;
    if (options && !options.some((option) => option.id === value))
      throw new Error("Invalid login choice.");
    this.pending.resolve(value);
  }
  private notify(event: AuthEvent) {
    if (event.type === "auth_url" || event.type === "device_code") {
      const link = event.type === "auth_url" ? event.url : event.verificationUri;
      // Only SDK-issued HTTPS URLs may be opened, never arbitrary renderer URLs.
      if (!safeLoginURL(link)) {
        this.cancel();
        return;
      }
      this.update({
        link,
        message:
          event.type === "device_code"
            ? `Enter device code: ${event.userCode}`
            : (event.instructions ??
              "Complete sign-in in your browser, or paste the callback below when requested."),
      });
      void this.browser(link).catch(() =>
        this.update({
          message: "Browser could not open. Use the displayed login link in your browser.",
        }),
      );
    }
  }
  cancel() {
    this.abort?.abort();
  }
  async close() {
    this.cancel();
    await this.loginSettled;
  }
  async logout(provider: string) {
    if (this.state.busy) throw new Error("Cancel login first.");
    this.update({ busy: true });
    try {
      await this.runtime!.logout(provider);
      await this.refresh();
    } finally {
      this.update({ busy: false });
    }
  }
}
export function safeLoginURL(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
