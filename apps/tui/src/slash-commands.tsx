import { Box, Text } from "ink";

/** Commands handled by the controller, plus the app-level /quit command. */
export const slashCommands = [
  { name: "/help", description: "Show commands and controls" },
  { name: "/character", description: "[RSN] — list or select a character" },
  { name: "/create", description: "MODE RSN — create a character" },
  { name: "/sync", description: "Import skills and quests from RuneMetrics" },
  { name: "/memory", description: "[query] — search saved facts" },
  { name: "/goals", description: "Show saved goals" },
  { name: "/history", description: "Show memory change history" },
  { name: "/pending", description: "Review pending memory changes" },
  { name: "/set", description: "KIND KEY = JSON — correct a fact" },
  { name: "/forget", description: "KIND KEY — propose deleting a fact" },
  { name: "/approve", description: "ID — approve a pending change" },
  { name: "/reject", description: "ID — reject a pending change" },
  { name: "/undo", description: "ID — undo a saved operation" },
  { name: "/new", description: "Start a new chat session" },
  { name: "/sessions", description: "List chat sessions" },
  { name: "/resume", description: "SESSION_ID — resume a chat" },
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

export interface CommandCompletion {
  matches: typeof slashCommands;
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
          ↑↓ select • Enter complete • Esc dismiss • {selected + 1}/{matches.length}
        </Text>
      )}
    </Box>
  );
}
