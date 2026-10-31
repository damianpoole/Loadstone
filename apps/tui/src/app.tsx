import { useEffect, useState, useSyncExternalStore } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { ChatInput, mouseReport } from "./chat-input";
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
export function CharacterSidebar({ state }: { state: AppState }) {
  const recent = [...state.facts].sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 3);
  return (
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
      <Text bold wrap="truncate-end">
        {plainText(state.character?.name ?? "No character selected")}
      </Text>
      <Text>{plainText(state.character?.mode ?? "Ironman companion")}</Text>
      <Text>
        {state.facts.filter((f) => f.kind === "quest" && f.value === "COMPLETED").length} quests
        known complete
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
        LAST SAVED FACTS
      </Text>
      <Text dimColor>Includes sync, not activity</Text>
      {recent.length ? (
        recent.map((f) => (
          <Box key={`${f.kind}:${f.key}`} flexDirection="column">
            <Text>
              {plainText(
                `${f.key}: ${typeof f.value === "string" ? (f.kind === "quest" ? f.value.replaceAll("_", " ") : f.value) : JSON.stringify(f.value)}`,
              )}
            </Text>
            <Text dimColor>
              {f.source === "runemetrics" ? "RuneMetrics sync" : "User reported"}
            </Text>
          </Box>
        ))
      ) : (
        <Text>No saved facts yet</Text>
      )}
    </Box>
  );
}
export function App({ controller, onQuit }: { controller: Controller; onQuit: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"chat" | "memory">("chat");
  // null follows the tail; a line index anchors the viewport while new text streams in.
  const [topLine, setTopLine] = useState<number | null>(null);
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  useEffect(() => {
    const resize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on("resize", resize);
    return () => {
      stdout.off("resize", resize);
    };
  }, [stdout]);
  useEffect(() => {
    if (!stdout.isTTY || process.env.LOADSTONE_MOUSE === "0") return;
    stdout.write("\x1b[?1000h\x1b[?1006h");
    return () => {
      stdout.write("\x1b[?1006l\x1b[?1000l");
    };
  }, [stdout]);
  const sidebar = size.columns >= 100;
  const bodyHeight = Math.max(3, size.rows - 8);
  const width = Math.max(10, size.columns - (sidebar ? 34 : 2));
  const lines = screenLines(state, tab, width);
  const maxScroll = Math.max(0, lines.length - bodyHeight);
  const start = topLine === null ? maxScroll : Math.min(topLine, maxScroll);
  const scrolled = start < maxScroll;
  const move = (delta: number) =>
    setTopLine((current) => {
      const next = Math.max(0, Math.min(current ?? maxScroll, maxScroll) + delta);
      return next >= maxScroll ? null : next;
    });
  useInput((text, key) => {
    const mouse = mouseReport(text);
    if (mouse) {
      // Ignore clicks, releases and horizontal wheel events; modifier bits are independent.
      if (mouse.pressed && mouse.button & 64 && !(mouse.button & 2)) {
        move(mouse.button & 1 ? 3 : -3);
      }
      return;
    }
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
      setTopLine(null);
    }
    if (key.pageUp) move(-Math.max(1, bodyHeight - 1));
    if (key.pageDown) move(Math.max(1, bodyHeight - 1));
    if (key.upArrow) move(-3);
    if (key.downArrow) move(3);
    if (key.home) setTopLine(0);
    if (key.end) setTopLine(null);
  });
  const submit = (value: string) => {
    if (value.trim() === "/quit") {
      onQuit();
      return;
    }
    if (state.processing) return;
    setInput("");
    setTopLine(null);
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
        {sidebar && <CharacterSidebar state={state} />}
      </Box>
      <Text color="yellow" wrap="truncate-end">
        {plainText(
          scrolled
            ? `Lines ${start + 1}–${Math.min(start + bodyHeight, lines.length)} of ${lines.length} • End: latest • /earlier: load older messages`
            : state.view.failure
              ? `${state.view.failure} — /retry`
              : state.view.activity.join(" | ") ||
                "Memory changes: /history • Conflicts: /pending • Older messages: /earlier",
        )}
      </Text>
      <Box borderStyle="single" borderColor="cyan">
        <Text color="cyan">› </Text>
        <ChatInput value={input} onChange={setInput} onSubmit={submit} />
      </Box>
      <Text dimColor wrap="truncate-end">
        ↑↓/Wheel: scroll • PgUp/PgDn: page • Home/End • Tab • Esc: cancel • /help
      </Text>
    </Box>
  );
}
