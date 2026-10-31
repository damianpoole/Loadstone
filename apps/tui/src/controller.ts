import { randomUUID } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MemoryStore,
  factKinds,
  type Character,
  type Fact,
  type FactKind,
  type FactValue,
  type ChatSession,
} from "@loadstone/memory";
import {
  openCompanion,
  syncCharacter,
  createCompanionConnection,
  type CompanionConnection,
  type Companion,
  type AgentView,
  type ModelRef,
} from "@loadstone/agent";

export const HELP = `Chat normally to ask for advice or report progress. Clear facts are saved automatically, with provenance.
/character [RSN] — list characters or select/create one (default Ironman)
/create MODE RSN — modes: ironman, hardcore, group-ironman
/sync — fetch fresh skills and quests; unavailable data never clears memory
/memory [query] • /goals • /history • /pending
/set KIND KEY = JSON — manually correct a fact, e.g. /set skill Herblore = 90
/forget KIND KEY — propose deletion; /approve ID or /reject ID after reviewing
/undo ID — undo a saved operation if no newer change affects its facts
/new • /sessions • /resume SESSION_ID • /earlier • /retry
/model PROVIDER MODEL_ID • /model pi • /models [filter] • /auth
/export — character JSON including history; /backup — all memory and sessions
/quit — save and quit (unfinished agent work resumes on reopen)
Esc — cancel agent/sync • PageUp/PageDown — scroll • Tab — chat/memory
Facts: skill=1–120, quest=COMPLETED|STARTED|NOT_STARTED, unlock=true|false,
item={"owned":true,"quantity":1}, goal="active"|"paused"|"completed", preference/note=text.
Unknown is not false. Items are last reported, not a live bank. /help shows this again.`;
export interface AppState {
  character?: Character;
  session?: ChatSession;
  facts: Fact[];
  view: AgentView;
  notice: string;
  processing: boolean;
  pending: number;
}
const emptyView = (): AgentView => ({
  messages: [],
  partial: "",
  busy: false,
  activity: [],
  hasEarlier: false,
});
export class Controller {
  readonly memory: MemoryStore;
  state: AppState = {
    facts: [],
    view: emptyView(),
    notice:
      "Welcome to Loadstone. Type /character YourRSN to begin, or /help.\nLocal memory stays on this machine. Chat and retrieved context are sent to your configured model provider.\nExisting pi login is reused automatically; /auth shows credential status. Do not paste credentials in chat. Automatic saves are visible in /history and reversible with /undo.",
    processing: false,
    pending: 0,
  };
  private listeners = new Set<() => void>();
  private companion?: Companion;
  private connection?: Promise<CompanionConnection>;
  private getConnection() {
    return (this.connection ??= createCompanionConnection().catch((error) => {
      this.connection = undefined;
      throw error;
    }));
  }
  private syncAbort?: AbortController;
  private closed = false;
  private closing?: Promise<void>;
  private operation?: Promise<void>;
  private epoch = 0;
  constructor(
    readonly home: string,
    private readonly openAgent = openCompanion,
  ) {
    this.memory = new MemoryStore(join(home, "memory.sqlite"));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(patch: Partial<AppState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private refresh() {
    const id = this.state.character?.id;
    this.update({
      facts: id ? this.memory.facts(id) : [],
      pending: id ? this.memory.pending(id).length : 0,
    });
  }
  report(error: unknown) {
    this.update({ notice: error instanceof Error ? error.message : String(error) });
  }
  private async defaultModel(): Promise<ModelRef> {
    const fallback = (await this.getConnection()).defaultModel;
    return {
      provider:
        process.env.LOADSTONE_PROVIDER ?? this.memory.setting("provider") ?? fallback.provider,
      modelId: process.env.LOADSTONE_MODEL ?? this.memory.setting("model") ?? fallback.modelId,
    };
  }
  initialize(): Promise<void> {
    if (this.operation) return this.operation;
    this.update({ processing: true });
    this.operation = this.restore().finally(() => {
      this.operation = undefined;
      this.update({ processing: false });
    });
    return this.operation;
  }
  private async restore() {
    const id = this.memory.setting("activeCharacter");
    if (!id) return;
    const character = this.memory.character(id);
    const sessions = this.memory.sessions(id);
    const session =
      sessions.find((s) => s.id === this.memory.setting(`session:${id}`)) ??
      sessions[0] ??
      this.memory.createSession(id);
    await this.activate(character, session);
  }
  private async activate(character: Character, session: ChatSession) {
    const epoch = ++this.epoch;
    await this.companion?.close();
    this.companion = undefined;
    this.update({ character, session, view: emptyView() });
    this.memory.setSetting("activeCharacter", character.id);
    this.memory.setSetting(`session:${character.id}`, session.id);
    this.refresh();
    await mkdir(join(this.home, "sessions"), { recursive: true, mode: 0o700 });
    this.companion = await this.openAgent({
      path: join(this.home, "sessions", `${session.id}.sqlite`),
      memory: this.memory,
      characterId: character.id,
      sessionId: session.id,
      model: await this.defaultModel(),
      models: (await this.getConnection()).models,
      onChange: (view) => {
        if (epoch === this.epoch && !this.closed) {
          this.update({ view });
          this.refresh();
        }
      },
      onError: (error) => {
        if (epoch === this.epoch) this.report(error);
      },
    });
  }
  async cancel() {
    this.syncAbort?.abort();
    await this.companion?.cancel();
    this.refresh();
  }
  execute(input: string): Promise<void> {
    if (this.closed || this.closing) return Promise.resolve();
    if (this.operation) {
      this.report("An operation is running. Esc cancels sync or agent work.");
      return Promise.resolve();
    }
    this.update({ processing: true });
    this.operation = this.run(input.trim())
      .catch((error) => this.report(error))
      .finally(() => {
        this.operation = undefined;
        this.update({ processing: false });
        this.refresh();
      });
    return this.operation;
  }
  private async run(input: string) {
    if (!input) return;
    if (input === "/help") {
      this.update({ notice: HELP });
      return;
    }
    const split = input.indexOf(" ");
    const command = split < 0 ? input : input.slice(0, split);
    const args = split < 0 ? "" : input.slice(split + 1).trim();
    if (command === "/auth") {
      this.update({ notice: (await this.getConnection()).authSummary });
      return;
    }
    if (command === "/models") {
      this.update({
        notice:
          (await this.getConnection()).models
            .getModels()
            .filter((m) => `${m.provider} ${m.id}`.toLowerCase().includes(args.toLowerCase()))
            .map((m) => `${m.provider} ${m.id}`)
            .join("\n") || "No matching models.",
      });
      return;
    }
    if (command === "/character" && !args) {
      this.update({
        notice:
          this.memory
            .characters()
            .map((c) => `${c.name} (${c.mode})`)
            .join("\n") || "No characters. Use /character YourRSN.",
      });
      return;
    }
    const id = this.state.character?.id;
    if (command === "/memory" || command === "/goals") {
      this.update({
        notice: id
          ? this.memory
              .facts(id, args, command === "/goals" ? "goal" : undefined)
              .map(
                (f) =>
                  `${f.kind} / ${f.key}: ${JSON.stringify(f.value)}\n  ${f.source}, observed ${new Date(f.observedAt).toISOString()}\n  ${f.evidence}`,
              )
              .join("\n") || "No saved facts match."
          : "Select a character first.",
      });
      return;
    }
    if (command === "/history" || command === "/pending") {
      this.update({
        notice: id
          ? JSON.stringify(
              command === "/pending" ? this.memory.pending(id) : this.memory.history(id, 30),
              null,
              2,
            )
          : "Select a character first.",
      });
      return;
    }
    if (command === "/sessions") {
      this.update({
        notice: id
          ? this.memory
              .sessions(id)
              .map((s) => `${s.id} — ${new Date(s.createdAt).toLocaleString()}`)
              .join("\n")
          : "Select a character first.",
      });
      return;
    }
    if (command === "/earlier") {
      await this.companion?.earlier();
      this.update({ notice: "Earlier history loaded. PageUp scrolls through it." });
      return;
    }
    if (command === "/retry") {
      await this.companion?.retry();
      return;
    }
    if (this.state.view.busy)
      throw new Error(
        "The agent is working. Press Esc to cancel before changing state or sending another message.",
      );
    if (command === "/character" || command === "/create") {
      const [mode, ...name] = args.split(" ");
      const character = this.memory.createCharacter(
        command === "/create" ? name.join(" ") : args,
        command === "/create" ? mode : "ironman",
      );
      const sessions = this.memory.sessions(character.id);
      const session =
        sessions.find((s) => s.id === this.memory.setting(`session:${character.id}`)) ??
        sessions[0] ??
        this.memory.createSession(character.id);
      await this.activate(character, session);
      this.update({
        notice: `Selected ${character.name} (${character.mode}). /sync imports available progress. /help shows controls.`,
      });
      return;
    }
    if (!id || !this.state.character)
      throw new Error("Select a character first with /character YourRSN.");
    if (command === "/new" || command === "/resume") {
      const session =
        command === "/new"
          ? this.memory.createSession(id)
          : this.memory.sessions(id).find((s) => s.id === args);
      if (!session) throw new Error("Session not found for this character. Use /sessions.");
      await this.activate(this.state.character, session);
      this.update({
        notice: `Session ${session.id}. Character memory is shared across this character's sessions.`,
      });
      return;
    }
    if (command === "/model") {
      const selected = args === "pi" ? (await this.getConnection()).defaultModel : undefined;
      const [provider, modelId, extra] = selected
        ? [selected.provider, selected.modelId]
        : args.split(/\s+/);
      if (!provider || !modelId || extra)
        throw new Error("Usage: /model PROVIDER MODEL_ID or /model pi. Use /models to list.");
      if (!this.companion) throw new Error("Session unavailable. Use /resume SESSION_ID.");
      await this.companion.setModel({ provider, modelId });
      this.memory.setSetting("provider", provider);
      this.memory.setSetting("model", modelId);
      this.update({
        notice: `Model: ${provider}/${modelId}. Use /auth for credential status.`,
      });
      return;
    }
    if (command === "/sync") {
      this.syncAbort = new AbortController();
      this.update({ notice: "Syncing fresh RuneMetrics skills and quests…" });
      try {
        this.update({
          notice: JSON.stringify(
            await syncCharacter(this.memory, id, `sync:${randomUUID()}`, this.syncAbort.signal),
            null,
            2,
          ),
        });
      } finally {
        this.syncAbort = undefined;
      }
      return;
    }
    if (command === "/set" || command === "/forget") {
      const match =
        command === "/set"
          ? /^(\w+)\s+(.+?)\s*=\s*(.+)$/s.exec(args)
          : /^(\w+)\s+(.+)$/s.exec(args);
      if (!match || !factKinds.includes(match[1] as FactKind))
        throw new Error("Use /set KIND KEY = JSON or /forget KIND KEY. See /help.");
      const receipt = this.memory.apply({
        characterId: id,
        operationId: `manual:${randomUUID()}`,
        source: "user",
        observedAt: Date.now(),
        evidence: `Explicit command: ${input}`,
        changes: [
          {
            kind: match[1] as FactKind,
            key: match[2],
            value: command === "/forget" ? null : (JSON.parse(match[3]) as FactValue),
          },
        ],
      });
      this.update({ notice: JSON.stringify(receipt, null, 2) });
      return;
    }
    if (["/approve", "/reject", "/undo"].includes(command)) {
      const receipt =
        command === "/undo"
          ? this.memory.undo(id, args)
          : this.memory.review(id, args, command === "/approve");
      this.update({ notice: JSON.stringify(receipt, null, 2) });
      return;
    }
    if (command === "/export") {
      const directory = join(this.home, "exports");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `${id}-${randomUUID()}.json`);
      await writeFile(path, JSON.stringify(this.memory.exportCharacter(id), null, 2), {
        mode: 0o600,
        flag: "wx",
      });
      this.update({
        notice: `Exported character facts and history to ${path}. This contains private character data, not credentials.`,
      });
      return;
    }
    if (command === "/backup") {
      const character = this.state.character;
      const session = this.state.session;
      ++this.epoch;
      await this.companion?.close();
      this.companion = undefined;
      try {
        const directory = join(this.home, "backups", randomUUID());
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await this.memory.backup(join(directory, "memory.sqlite"));
        await cp(join(this.home, "sessions"), join(directory, "sessions"), { recursive: true });
        this.update({
          notice: `Backup saved to ${directory}. Restore into an empty LOADSTONE_HOME while the app is closed.`,
        });
      } finally {
        if (session) await this.activate(character, session);
      }
      return;
    }
    if (input.startsWith("/")) throw new Error("Unknown command. Use /help.");
    if (!this.companion) throw new Error("Session unavailable. Use /resume SESSION_ID.");
    await this.companion.send(input);
    this.update({ notice: "" });
  }
  close(): Promise<void> {
    if (!this.closing)
      this.closing = (async () => {
        this.syncAbort?.abort();
        await this.operation?.catch(() => {});
        ++this.epoch;
        try {
          await this.companion?.close();
        } finally {
          this.closed = true;
          this.memory.close();
        }
      })();
    return this.closing;
  }
}
