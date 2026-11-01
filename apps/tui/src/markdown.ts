import { Chalk, type ChalkInstance } from "chalk";
import { Lexer, type MarkedToken, type Token } from "marked";
import stripAnsi from "strip-ansi";

/** Sanitize untrusted content before adding our own terminal styling. */
export function plainText(text: string): string {
  // eslint-disable-next-line no-control-regex -- strip untrusted terminal controls
  return stripAnsi(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}
// The TUI requires a terminal. Honor NO_COLOR while keeping formatting in Ink's
// redirected/test streams; colour detection on a bundled dependency is unreliable.
export const terminalStyle = new Chalk({ level: process.env.NO_COLOR === undefined ? 1 : 0 });

/** Render only built-in Markdown tokens, never HTML or terminal escape sequences. */
export function renderMarkdown(text: string, style: ChalkInstance = terminalStyle): string {
  const render = (tokens: Token[]): string => tokens.map(renderToken).join("");
  const indent = (text: string, prefix: string) =>
    text
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
  const renderToken = (input: Token): string => {
    // A private lexer with no extensions emits only the built-in token union.
    const token = input as MarkedToken;
    switch (token.type) {
      case "strong":
        return style.bold(render(token.tokens));
      case "em":
        return style.italic(render(token.tokens));
      case "del":
        return style.strikethrough(render(token.tokens));
      case "codespan":
        return style.yellow(token.text);
      case "heading":
        return `${style.bold(render(token.tokens))}\n\n`;
      case "paragraph":
        return `${render(token.tokens)}\n\n`;
      case "text":
        return token.tokens ? render(token.tokens) : token.text;
      case "escape":
        return token.text;
      case "br":
        return "\n";
      case "space":
        return "";
      case "hr":
        return `${style.dim("────────────────────")}\n\n`;
      case "code":
        return `${indent(style.yellow(token.text), "  ")}\n\n`;
      case "blockquote":
        return `${style.dim(indent(render(token.tokens).trimEnd(), "│ "))}\n\n`;
      case "list":
        return (
          "\n" +
          token.items
            .map((item, index) => {
              const bullet = item.task
                ? item.checked
                  ? "[x] "
                  : "[ ] "
                : token.ordered
                  ? `${Number(token.start) + index}. `
                  : "• ";
              const lines = render(item.tokens).trim().split("\n");
              return bullet + lines.join("\n" + " ".repeat(bullet.length));
            })
            .join("\n") +
          "\n\n"
        );
      case "list_item":
        return render(token.tokens);
      case "checkbox":
        return token.checked ? "[x] " : "[ ] ";
      case "link": {
        const label = render(token.tokens);
        return label === token.href
          ? style.underline(label)
          : `${style.underline(label)} (${token.href})`;
      }
      case "image":
        return `[image: ${render(token.tokens)}] (${token.href})`;
      case "table":
        return (
          [
            style.bold(token.header.map((cell) => render(cell.tokens)).join(" | ")),
            style.dim(token.header.map(() => "───").join("─┼─")),
            ...token.rows.map((row) => row.map((cell) => render(cell.tokens)).join(" | ")),
          ].join("\n") + "\n\n"
        );
      // Raw HTML stays literal text; we do not interpret it or load remote content.
      case "html":
        return token.text;
      case "def":
        return "";
      default:
        return input.raw;
    }
  };
  const safe = plainText(text);
  try {
    return render(new Lexer({ gfm: true }).lex(safe)).trimEnd();
  } catch {
    // Incomplete streaming input or malformed Markdown must never break the UI.
    return safe;
  }
}
