import { useState } from "react";
import { Text, useInput } from "ink";
import stripAnsi from "strip-ansi";

/** SGR mouse reports arrive through Ink's input parser with the ESC prefix removed. */
export function mouseReport(input: string): { button: number; pressed: boolean } | undefined {
  const match = /^\[<(\d+);\d+;\d+([Mm])$/.exec(input);
  return match ? { button: Number(match[1]), pressed: match[2] === "M" } : undefined;
}

/** Keep navigation/mouse events out of the draft (ink-text-input treats unknown events as text). */
export function ChatInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const [position, setPosition] = useState(0);
  const characters = Array.from(value);
  const cursor = Math.min(position, characters.length);
  useInput((input, key) => {
    if (
      mouseReport(input) ||
      key.escape ||
      key.tab ||
      key.upArrow ||
      key.downArrow ||
      key.pageUp ||
      key.pageDown ||
      key.home ||
      key.end ||
      key.ctrl ||
      key.meta
    )
      return;
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.leftArrow) {
      setPosition(Math.max(0, cursor - 1));
      return;
    }
    if (key.rightArrow) {
      setPosition(Math.min(characters.length, cursor + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        characters.splice(cursor - 1, 1);
        onChange(characters.join(""));
        setPosition(cursor - 1);
      }
      return;
    }
    if (!input) return;
    // Normalize pasted line breaks so the editor remains a single logical input line.
    const clean = stripAnsi(input)
      .replace(/[\r\n\t]/g, " ")
      // eslint-disable-next-line no-control-regex -- do not render pasted terminal controls
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
    const inserted = Array.from(clean);
    characters.splice(cursor, 0, ...inserted);
    onChange(characters.join(""));
    setPosition(cursor + inserted.length);
  });
  if (!value)
    return (
      <Text>
        <Text inverse> </Text>
        <Text dimColor>Chat or /help</Text>
      </Text>
    );
  return (
    <Text>
      {characters.slice(0, cursor).join("")}
      <Text inverse>{characters[cursor] ?? " "}</Text>
      {characters.slice(cursor + 1).join("")}
    </Text>
  );
}
