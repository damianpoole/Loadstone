import { randomUUID } from "node:crypto";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
  Harness,
  createRegistry,
  type ModelRef,
  type EntryRecord,
  type LiveState,
  type ConversationView,
  type EntryId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { MemoryStore } from "@loadstone/memory";
import { characterExtension } from "./tools";
export { syncCharacter, characterSummary } from "./tools";
export type { ModelRef };

export interface ChatMessage {
  id: string;
  role: "You" | "Assistant" | "Tool" | "System";
  text: string;
}
export interface AgentView {
  messages: ChatMessage[];
  partial: string;
  busy: boolean;
  activity: string[];
  failure?: string;
  model?: ModelRef;
  hasEarlier: boolean;
}
export function createCompanionModels() {
  const models = createModels();
  models.setProvider(openaiProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(openrouterProvider());
  return models;
}
export function entryMessages(entry: EntryRecord): ChatMessage[] {
  if (entry.kind === "pi.system") return [];
  return (entry.model ?? []).flatMap<ChatMessage>((message, index) => {
    if (message.role === "system") return [];
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n");
    if (message.role === "toolResult") {
      // Wiki pages are not dumped into the chat; detailed memory receipts live in /history.
      let detail = "done";
      if (message.isError) detail = `failed — ${text.slice(0, 500)}`;
      else if (text.startsWith("Tool-round limit reached")) detail = text;
      else if (message.toolName === "sync_runemetrics") detail = text;
      else if (message.toolName === "update_character_memory") {
        try {
          const receipt = JSON.parse(text) as {
            status: string;
            id: string;
            changes: { key: string; after: { value: unknown } | null }[];
          };
          detail = `${receipt.status === "saved" ? "Saved" : "Not saved — review required"}: ${receipt.changes.map((c) => `${c.key} → ${JSON.stringify(c.after?.value ?? null)}`).join(", ")}\nOperation: ${receipt.id} (/history, /undo ID, /pending)`;
        } catch {
          detail = text.slice(0, 1000);
        }
      }
      return [
        {
          id: `${entry.id}:${index}`,
          role: "Tool" as const,
          text: `${message.toolName}: ${detail}`,
        },
      ];
    }
    if (!text && message.role !== "assistant") return [];
    if (message.role === "assistant" && !text && !message.errorMessage) return [];
    return [
      {
        id: `${entry.id}:${index}`,
        role:
          entry.kind === "pi.compaction"
            ? ("System" as const)
            : message.role === "user"
              ? ("You" as const)
              : ("Assistant" as const),
        text: text || (message.role === "assistant" ? (message.errorMessage ?? "") : ""),
      },
    ];
  });
}
export async function openCompanion(options: {
  path: string;
  memory: MemoryStore;
  characterId: string;
  sessionId: string;
  model: ModelRef;
  models?: Models;
  onChange: (view: AgentView) => void;
  onError?: (error: string) => void;
}) {
  const models = options.models ?? createCompanionModels();
  const registry = createRegistry();
  registry.install(characterExtension(options.memory, options.characterId, options.sessionId));
  const harness = await Harness.open(
    await openNodeSqliteStorage(options.path),
    {
      models,
      registry,
      identity: {
        attribution: { name: "Loadstone", url: "https://github.com/damianpoole/Loadstone" },
      },
      settings: {
        toolExecution: "sequential",
        retry: { maxRetries: 2 },
        stream: { timeoutMs: 90_000 },
        afterFailedRun: "withdraw",
      },
      onReport: (error, info) =>
        options.onError?.(
          `${info.type}: ${error instanceof Error ? error.message : String(error)}`,
        ),
    },
    BACKGROUND_CONTEXT,
  );
  try {
    const root = await harness.root(BACKGROUND_CONTEXT, { agent: { model: options.model } });
    const watch = await root.watch(BACKGROUND_CONTEXT);
    const entries = new Map<number, EntryRecord>();
    // 1.4.0 watches expose active context, not the newer upstream window API.
    let hasEarlier = watch.value.entries.length > 0;
    let latest = watch.value;
    let closed = false;
    let failure: string | undefined;
    const publish = (view: ConversationView) => {
      latest = view;
      for (const entry of view.entries) entries.set(entry.id, entry);
      const live = view.docs["pi.live"] as unknown as LiveState | undefined;
      const model = view.docs["pi.agent"]?.model as unknown as ModelRef | undefined;
      options.onChange({
        messages: [...entries.values()].sort((a, b) => a.id - b.id).flatMap(entryMessages),
        partial:
          live?.generation?.message?.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n") ?? "",
        busy: live?.run !== undefined,
        activity: [
          ...(live?.tools ?? [])
            .filter((t) => t.status !== "done")
            .map((t) => `${t.name}: ${t.status}`),
          ...(live?.generation?.retry ? ["Retrying model request…"] : []),
          ...(live?.compactions?.length ? ["Compacting conversation…"] : []),
        ],
        failure: live?.run ? undefined : failure,
        model,
        hasEarlier,
      });
    };
    publish(watch.value);
    watch.start(async (value) => {
      publish(value);
    });
    void watch.closed.then((end) => {
      if (end.reason === "session_failed" || end.reason === "listener_error")
        options.onError?.("Conversation storage/view failed. Quit and reopen to recover.");
    });
    const track = (submission: Awaited<ReturnType<typeof root.submit>>) => {
      void submission
        .wait(BACKGROUND_CONTEXT)
        .then((result) => {
          if (closed) return;
          failure =
            result.status === "unanswered"
              ? `${result.reason}: ${JSON.stringify(result.detail ?? "")}`
              : undefined;
          publish(latest);
        })
        .catch((error) => {
          if (!closed) options.onError?.(String(error));
        });
      return submission;
    };
    const inspection = await harness.inspect(BACKGROUND_CONTEXT);
    for (const task of inspection.tasks)
      if (task.state.kind === "blocked")
        options.onError?.(
          `Task blocked: ${task.state.reason}. /retry retries parked work; Esc cancels it.`,
        );
    for (const pending of inspection.submissions) {
      const submission = await harness.submission(pending.id, BACKGROUND_CONTEXT);
      if (submission) track(submission);
    }
    harness.resume();
    return {
      async send(content: string, requestId = randomUUID()) {
        if (!content.trim()) throw new Error("Enter a message.");
        const agent = await root.agent(BACKGROUND_CONTEXT);
        if (!agent.model || !models.getModel(agent.model.provider, agent.model.modelId))
          throw new Error("Unknown model. Use /model PROVIDER MODEL_ID.");
        if (!(await models.getAuth(agent.model.provider)))
          throw new Error(
            `Set credentials for ${agent.model.provider} in your environment, then restart. Memory and sync work without a model key.`,
          );
        failure = undefined;
        return track(
          await root.submit(
            { type: "input", content, requestId, whenBusy: "reject" },
            BACKGROUND_CONTEXT,
          ),
        );
      },
      async retry() {
        const inspection = await harness.inspect(BACKGROUND_CONTEXT);
        const parked = inspection.tasks.filter(
          (t) => t.state.kind === "blocked" && t.state.reason === "restart_limit",
        );
        if (parked.length) {
          for (const task of parked) await harness.retryTask(task.record.id, BACKGROUND_CONTEXT);
          return;
        }
        return track(
          await root.submit(
            {
              type: "input",
              content:
                "Please continue the previous request using current memory. Do not treat this message as new character progress.",
              whenBusy: "reject",
            },
            BACKGROUND_CONTEXT,
          ),
        );
      },
      async cancel() {
        await root.abort(BACKGROUND_CONTEXT);
      },
      async setModel(model: ModelRef) {
        if (!models.getModel(model.provider, model.modelId))
          throw new Error("Unknown model. Use /models to list supported models.");
        await root.configure({ model }, BACKGROUND_CONTEXT);
      },
      async earlier() {
        const oldest = [...entries.keys()].sort((a, b) => a - b)[0];
        if (!hasEarlier || oldest === undefined) return;
        const page = await root.entries(
          { maxEntryId: (oldest - 1) as EntryId, order: "descending" },
          50,
          undefined,
          BACKGROUND_CONTEXT,
        );
        for (const entry of page.items) entries.set(entry.id, entry);
        hasEarlier = page.next !== undefined;
        publish(latest);
      },
      async close() {
        closed = true;
        await watch.stop();
        await harness.close(BACKGROUND_CONTEXT);
      },
    };
  } catch (error) {
    await harness.close(BACKGROUND_CONTEXT);
    throw error;
  }
}
export type Companion = Awaited<ReturnType<typeof openCompanion>>;
