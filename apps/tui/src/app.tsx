import { useEffect, useState, useSyncExternalStore } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import wrapAnsi from "wrap-ansi";
import stripAnsi from "strip-ansi";
import type { Controller, AppState } from "./controller";

/** Never allow wiki/model/user text to inject terminal control sequences. */
export function plainText(text: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally strip untrusted terminal controls
  return stripAnsi(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}
export function screenLines(state: AppState, tab: "chat" | "memory", width: number): string[] {
  const content =
    tab === "memory"
      ? state.facts
          .map(
            (f) =>
              `${f.kind} / ${f.key}: ${JSON.stringify(f.value)}\n  ${f.source} • ${new Date(f.observedAt).toLocaleDateString()} (last observed)`,
          )
          .join("\n") ||
        "No memory yet. /sync imports progress, or tell the agent about your character."
      : [
          ...state.view.messages.map((m) => `${m.role}: ${m.text}\n`),
          ...(state.view.partial ? [`Assistant: ${state.view.partial}`] : []),
          ...(state.notice ? [`Loadstone: ${state.notice}`] : []),
        ].join("\n");
  return wrapAnsi(plainText(content), Math.max(10, width), { hard: true, trim: false }).split("\n");
}
export function App({ controller, onQuit }: { controller: Controller; onQuit: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"chat" | "memory">("chat");
  const [scroll, setScroll] = useState(0);
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  useEffect(() => {
    const resize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on("resize", resize);
    return () => {
      stdout.off("resize", resize);
    };
  }, [stdout]);
  const sidebar = size.columns >= 100;
  const bodyHeight = Math.max(3, size.rows - 8);
  const width = Math.max(10, size.columns - (sidebar ? 34 : 2));
  const lines = screenLines(state, tab, width);
  const maxScroll = Math.max(0, lines.length - bodyHeight);
  const effectiveScroll = Math.min(scroll, maxScroll);
  const start = Math.max(0, lines.length - bodyHeight - effectiveScroll);
  useInput((text, key) => {
    if (key.ctrl && text === "c") {
      onQuit();
      return;
    }
    if (key.escape) {
      void controller.cancel().catch((error) => controller.report(error));
      return;
    }
    if (key.tab) {
      setTab((t) => (t === "chat" ? "memory" : "chat"));
      setScroll(0);
    }
    if (key.pageUp) setScroll((s) => Math.min(maxScroll, s + bodyHeight));
    if (key.pageDown) setScroll((s) => Math.max(0, s - bodyHeight));
  });
  const submit = (value: string) => {
    if (value.trim() === "/quit") {
      onQuit();
      return;
    }
    if (state.processing) return;
    setInput("");
    setScroll(0);
    setTab("chat");
    void controller.execute(value);
  };
  const model = state.view.model;
  const status = state.processing ? "Working" : state.view.busy ? "Agent working" : "Ready";
  return (
    <Box flexDirection="column" width={size.columns} height={Math.max(12, size.rows)}>
      <Text bold color="cyan" wrap="truncate-end">
        Loadstone — {plainText(state.character?.name ?? "Choose a character")} | {status} | {tab}
      </Text>
      <Text dimColor wrap="truncate-end">
        {model ? `${model.provider}/${model.modelId}` : "Model configured on session creation"} |{" "}
        {state.pending} pending memory reviews
      </Text>
      <Box height={bodyHeight} flexDirection="row">
        <Box
          width={sidebar ? size.columns - 32 : size.columns}
          flexDirection="column"
          overflow="hidden"
        >
          <Text>{lines.slice(start, start + bodyHeight).join("\n")}</Text>
        </Box>
        {sidebar && (
          <Box
            width={32}
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            overflow="hidden"
          >
            <Text bold color="green">
              CHARACTER
            </Text>
            <Text>{plainText(state.character?.mode ?? "Ironman companion")}</Text>
            <Text>
              {state.facts.filter((f) => f.kind === "quest" && f.value === "COMPLETED").length}{" "}
              quests known complete
            </Text>
            <Text bold color="yellow">
              GOALS
            </Text>
            <Text>
              {plainText(
                state.facts
                  .filter((f) => f.kind === "goal" && f.value === "active")
                  .slice(0, 3)
                  .map((f) => `• ${f.key}`)
                  .join("\n") || "No active goals",
              )}
            </Text>
            <Text bold color="yellow">
              RECENT MEMORY
            </Text>
            <Text>
              {plainText(
                [...state.facts]
                  .sort((a, b) => b.recordedAt - a.recordedAt)
                  .slice(0, 3)
                  .map((f) => `${f.key}: ${JSON.stringify(f.value)}`)
                  .join("\n"),
              )}
            </Text>
          </Box>
        )}
      </Box>
      <Text color="yellow" wrap="truncate-end">
        {plainText(
          state.view.failure
            ? `${state.view.failure} — /retry`
            : state.view.activity.join(" | ") ||
                (effectiveScroll
                  ? `Scrolled ${effectiveScroll} lines — PageDown returns to latest`
                  : "Memory changes: /history • Conflicts: /pending • Older messages: /earlier"),
        )}
      </Text>
      <Box borderStyle="single" borderColor="cyan">
        <Text color="cyan">› </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder="Chat or /help"
        />
      </Box>
      <Text dimColor wrap="truncate-end">
        Tab: chat/memory • PgUp/PgDn: scroll • Esc: cancel • /help • /quit
      </Text>
    </Box>
  );
}
