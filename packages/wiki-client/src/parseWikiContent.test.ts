import { describe, it, expect } from "vitest";
import { parseWikiContent } from "./index";

describe("parseWikiContent", () => {
  it("should parse simple HTML with sections", () => {
    const html = `
      <div class="mw-parser-output">
        <p>Summary content here</p>
        <h2>First Section</h2>
        <p>Section content</p>
        <h2>Second Section</h2>
        <p>More content</p>
      </div>
    `;

    const result = parseWikiContent(html);

    expect(result).toHaveProperty("Summary");
    expect(result).toHaveProperty("First Section");
    expect(result).toHaveProperty("Second Section");
    expect(result["Summary"]).toContain("Summary content here");
    expect(result["First Section"]).toContain("Section content");
  });

  it("should remove edit links from headers", () => {
    const html = `
      <div class="mw-parser-output">
        <h2>Section Title [edit]</h2>
        <p>Content</p>
      </div>
    `;

    const result = parseWikiContent(html);

    expect(result).toHaveProperty("Section Title");
    expect(result["Section Title"]).toContain("Content");
  });

  it("should parse tables into pipe-delimited format", () => {
    const html = `
      <div class="mw-parser-output">
        <h2>Stats</h2>
        <table>
          <tr>
            <th>Name</th>
            <th>Value</th>
          </tr>
          <tr>
            <td>Attack</td>
            <td>70</td>
          </tr>
        </table>
      </div>
    `;

    const result = parseWikiContent(html);

    expect(result["Stats"]).toContain("|");
    expect(result["Stats"]).toContain("Attack");
    expect(result["Stats"]).toContain("70");
  });

  it("should parse lists into bullet points", () => {
    const html = `
      <div class="mw-parser-output">
        <h2>Items</h2>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      </div>
    `;

    const result = parseWikiContent(html);

    expect(result["Items"]).toContain("Item 1");
    expect(result["Items"]).toContain("Item 2");
  });

  it("should remove navigation boxes and scripts", () => {
    const html = `
      <div class="mw-parser-output">
        <p>Content</p>
        <div class="navbox">Navigation</div>
        <script>console.log('test');</script>
        <style>.test { color: red; }</style>
      </div>
    `;

    const result = parseWikiContent(html);

    expect(result["Summary"]).toContain("Content");
    expect(result["Summary"]).not.toContain("Navigation");
    expect(result["Summary"]).not.toContain("console.log");
    expect(result["Summary"]).not.toContain(".test");
  });

  it("should handle subheaders", () => {
    const html = `
      <div class="mw-parser-output">
        <h2>Main Section</h2>
        <h3>Subsection</h3>
        <p>Subsection content</p>
        <h4>Sub-subsection</h4>
        <p>More content</p>
      </div>
    `;

    const result = parseWikiContent(html);

    expect(result["Main Section"]).toContain("Subsection");
    expect(result["Main Section"]).toContain("Subsection content");
    expect(result["Main Section"]).toContain("Sub-subsection");
  });

  it("should handle empty HTML", () => {
    const result = parseWikiContent("");
    expect(result).toEqual({});
  });

  it("should handle HTML without mw-parser-output wrapper", () => {
    const html = `
      <h2>Section</h2>
      <p>Content</p>
    `;

    const result = parseWikiContent(html);
    expect(result).toHaveProperty("Summary");
  });
});
