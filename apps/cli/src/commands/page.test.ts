import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vite-plus/test";
import { page } from "./page";
import * as wikiClient from "@loadstone/wiki-client";

vi.mock("@loadstone/wiki-client");
vi.mock("chalk", () => {
  const mockChalk = (str: string) => str;
  mockChalk.blue = mockChalk;
  mockChalk.green = mockChalk;
  mockChalk.yellow = mockChalk;
  mockChalk.red = mockChalk;
  mockChalk.bold = mockChalk;
  mockChalk.dim = mockChalk;
  return { default: mockChalk };
});

const mockPage = {
  title: "Abyssal whip",
  pageid: 12345,
  revid: 67890,
  extract:
    '<div class="mw-parser-output"><h2>Stats</h2><p>Content</p><h2>Drop sources</h2><p>Drops</p></div>',
} satisfies wikiClient.WikiPage;

describe("page command", () => {
  let consoleSpy: MockInstance<typeof console.log>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(wikiClient.getPage).mockResolvedValue(mockPage);
    vi.mocked(wikiClient.parseWikiContent).mockReturnValue({
      Stats: "Content",
      "Drop sources": "Drops",
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("displays page content in text mode", async () => {
    await page("Abyssal whip", {});
    expect(wikiClient.getPage).toHaveBeenCalledWith("Abyssal whip", {
      json: true,
      section: undefined,
      cache: {},
    });
    expect(wikiClient.parseWikiContent).toHaveBeenCalledWith(mockPage.extract);
    expect(consoleSpy).toHaveBeenCalledWith("Content");
    expect(consoleSpy).toHaveBeenCalledWith("Drops");
  });

  it.each([
    { options: {}, sections: { Stats: "Content", "Drop sources": "Drops" } },
    { options: { headings: true }, sections: ["Stats", "Drop sources"] },
    { options: { fields: "Drop sources" }, sections: { "Drop sources": "Drops" } },
    { options: { headings: true, section: "Drop" }, sections: ["Drop sources"] },
    { options: { section: "missing" }, sections: {} },
  ])("outputs structured JSON for $options", async ({ options, sections }) => {
    await page("Abyssal whip", { ...options, json: true });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toEqual({
      title: "Abyssal whip",
      pageId: 12345,
      url: "https://runescape.wiki/w/Abyssal_whip",
      lastModified: 67890,
      sections,
    });
  });

  it("filters sections in text mode", async () => {
    await page("Abyssal whip", { section: "Drop" });
    expect(wikiClient.getPage).toHaveBeenCalledWith("Abyssal whip", {
      json: true,
      section: "Drop",
      cache: {},
    });
    expect(consoleSpy).toHaveBeenCalledWith("Drops");
    expect(consoleSpy).not.toHaveBeenCalledWith("Content");
  });

  it("reports unavailable sections in text mode", async () => {
    await page("Abyssal whip", { section: "missing" });
    expect(consoleSpy).toHaveBeenCalledWith("Section 'missing' not found.");
  });

  it("handles a missing page in text mode", async () => {
    vi.mocked(wikiClient.getPage).mockResolvedValueOnce(null);
    await page("NonExistentPage", {});
    expect(consoleSpy).toHaveBeenCalledWith("Page not found.");
  });

  it("rejects an unexpected text response instead of treating it as metadata", async () => {
    vi.mocked(wikiClient.getPage).mockResolvedValueOnce("unexpected text");
    await page("Abyssal whip", { json: true });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toEqual({ error: "Page not found" });
    expect(wikiClient.parseWikiContent).not.toHaveBeenCalled();
  });

  it("returns only an error object for a missing page in JSON mode", async () => {
    vi.mocked(wikiClient.getPage).mockResolvedValueOnce(null);
    await page("NonExistentPage", { json: true });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toEqual({ error: "Page not found" });
  });
});
