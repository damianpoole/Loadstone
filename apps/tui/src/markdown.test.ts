import { Chalk } from "chalk";
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vite-plus/test";
import { renderMarkdown } from "./markdown";

const style = new Chalk({ level: 1 });
describe("terminal Markdown", () => {
  it("renders headings, nested emphasis, inline code and strikethrough with ANSI styles", () => {
    const result = renderMarkdown(
      "## Training\n\nUse **bold and *italic***, `Herblore`, and ~~obsolete~~.",
      style,
    );
    expect(stripAnsi(result)).toBe("Training\n\nUse bold and italic, Herblore, and obsolete.");
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[3m");
    expect(result).not.toContain("\x1b[4m");
    expect(result).toContain("\x1b[9m");
    expect(result).toContain(style.yellow("Herblore"));
  });
  it("uses bold rather than underline for emphasis and headings, reserving underline for links", () => {
    expect(renderMarkdown("**Bold text**", style)).toBe("\x1b[1mBold text\x1b[22m");
    for (let depth = 1; depth <= 6; depth++) {
      expect(renderMarkdown(`${"#".repeat(depth)} Heading`, style)).toBe("\x1b[1mHeading\x1b[22m");
    }
    expect(renderMarkdown("[Wiki](https://runescape.wiki/)", style)).toBe(
      "\x1b[4mWiki\x1b[24m (https://runescape.wiki/)",
    );
  });
  it("renders nested lists, ordered lists and task lists", () => {
    const result = stripAnsi(
      renderMarkdown(
        "- Herbs\n  - Clean them\n\n3. Train\n4. Quest\n\n- [x] Done\n- [ ] Next",
        style,
      ),
    );
    expect(result).toContain("• Herbs");
    expect(result).toContain("  • Clean them");
    expect(result).toContain("3. Train\n4. Quest");
    expect(result).toContain("[x] Done");
    expect(result).toContain("[ ] Next");
  });
  it("preserves code indentation and literal Markdown inside fences", () => {
    const result = stripAnsi(
      renderMarkdown("```ts\nconst text = '**literal**';\n  nested();\n```", style),
    );
    expect(result).toBe("  const text = '**literal**';\n    nested();");
    expect(result).not.toContain("```");
  });
  it("shows readable quotes, tables, links and images without terminal hyperlinks", () => {
    const result = renderMarkdown(
      "> Important **advice**\n\n| Skill | Level |\n| --- | --- |\n| Herblore | 90 |\n\n[Wiki](https://runescape.wiki/) ![Map](https://example.com/map.png)",
      style,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("│ Important advice");
    expect(plain).toContain("Skill | Level");
    expect(plain).toContain("Herblore | 90");
    expect(plain).toContain("Wiki (https://runescape.wiki/)");
    expect(plain).toContain("[image: Map] (https://example.com/map.png)");
    expect(result).not.toContain("\x1b]");
  });
  it("strips untrusted terminal controls before adding trusted formatting and leaves HTML inert", () => {
    const result = renderMarkdown(
      "\x1b[31m**Safe**\x1b[0m\x1b]52;c;secret\x07\n\n<script>alert(1)</script>\x00",
      style,
    );
    expect(result).toContain(style.bold("Safe"));
    expect(result).not.toContain("\x1b[31m");
    expect(result).not.toContain("secret");
    expect(stripAnsi(result)).toContain("<script>alert(1)</script>");
    expect(result).not.toContain("\x00");
  });
  it("handles incomplete streaming input and supports colour-free output", () => {
    const sample = "**Training**\n\n- [Wiki](https://runescape.wiki/)\n\n```ts\nconst x = 1;\n```";
    for (let i = 0; i <= sample.length; i++)
      expect(() => renderMarkdown(sample.slice(0, i), style)).not.toThrow();
    const plain = renderMarkdown("**Bold** and `code`", new Chalk({ level: 0 }));
    expect(plain).toBe("Bold and code");
  });
});
