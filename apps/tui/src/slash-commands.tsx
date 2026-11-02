import { Box, Text } from "ink";
import type { ChatSession } from "@loadstone/memory";
import { plainText } from "./markdown";

/** Commands handled by the controller, plus the app-level /quit command. */
export const slashCommands = [
  { name: "/help", description: "Show commands and controls" },
  { name: "/character", description: "[RSN] — list or select a character" },
  { name: "/create", description: "MODE RSN — create a character" },
  { name: "/sync", description: "Import skills and quests from RuneMetrics" },
  { name: "/memory", description: "[query] — search saved facts" },
  { name: "/goals", description: "[query] — browse goals and ordered plan subgoals" },
  { name: "/plan", description: "TARGET — research an outcome and save nested goals" },
  { name: "/history", description: "Show memory change history" },
  { name: "/pending", description: "Review pending memory changes" },
  { name: "/set", description: "KIND KEY = JSON — correct a fact" },
  { name: "/forget", description: "KIND KEY — propose deleting a fact" },
  { name: "/approve", description: "ID — approve a pending change" },
  { name: "/reject", description: "ID — reject a pending change" },
  { name: "/undo", description: "ID — undo a saved operation" },
  { name: "/new", description: "Start a new chat session" },
  { name: "/sessions", description: "[query] — find and switch chat sessions" },
  { name: "/session", description: "[query] — find and switch chat sessions" },
  { name: "/resume", description: "[title or ID] — find and resume a chat" },
  { name: "/earlier", description: "Load older messages" },
  { name: "/retry", description: "Retry the last failed turn" },
  { name: "/model", description: "PROVIDER MODEL_ID or pi — select a model" },
  { name: "/models", description: "[filter] — list available models" },
  { name: "/auth", description: "Show credential status" },
  { name: "/export", description: "Export character JSON and history" },
  { name: "/backup", description: "Back up all memory and sessions" },
  { name: "/quit", description: "Save and quit" },
];

export function matchingCommands(value: string) {
  if (!/^\/\S*$/.test(value)) return [];
  return slashCommands.filter((command) => command.name.startsWith(value.toLowerCase()));
}

export interface CompletionItem {
  name: string;
  description: string;
  value?: string;
  submit?: boolean;
}

export function sessionQuery(value: string): string | undefined {
  const match = /^\/(?:resume|sessions|session)(?:\s+(.*))?$/i.exec(value);
  return match ? (match[1] ?? "") : undefined;
}

/** Match title words in any order, with gaps allowed (and keep exact IDs usable). */
export function matchingSessions(
  value: string,
  sessions: ChatSession[],
  activeId?: string,
): CompletionItem[] {
  const query = sessionQuery(value);
  if (query === undefined) return [];
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return sessions
    .filter((session) => {
      const text = `${session.title} ${session.id}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .map((session) => ({
      name: `${plainText(session.title || "Untitled session")} · ${session.id.slice(0, 8)}`,
      description: `${new Date(session.createdAt).toLocaleString()}${session.id === activeId ? " • active" : ""}`,
      value: `/resume ${session.id}`,
      submit: true,
    }));
}

export interface CommandCompletion {
  matches: CompletionItem[];
  selected: number;
  select: (index: number) => void;
  dismiss: () => void;
}

export function CommandMenu({
  completion,
  height,
}: {
  completion: CommandCompletion;
  height: number;
}) {
  const { matches, selected } = completion;
  const visible = Math.max(1, Math.min(6, height - 3));
  const start = Math.max(0, selected - visible + 1);
  return (
    <Box
      position="absolute"
      bottom={0}
      width="100%"
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      backgroundColor="black"
    >
      {matches.slice(start, start + visible).map((command, index) => (
        <Text
          key={command.name}
          inverse={start + index === selected}
          color={start + index === selected ? "cyan" : undefined}
          wrap="truncate-end"
        >
          {start + index === selected ? "› " : "  "}
          {command.name} — {command.description}
        </Text>
      ))}
      {height >= 4 && (
        <Text dimColor wrap="truncate-end">
          ↑↓ select • Enter {matches[selected]?.submit ? "switch" : "complete"} • Esc dismiss •{" "}
          {selected + 1}/{matches.length}
        </Text>
      )}
    </Box>
  );
}
