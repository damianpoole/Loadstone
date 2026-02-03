import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { search } from "./search";
import * as wikiClient from "@loadstone/wiki-client";

vi.mock("@loadstone/wiki-client");
vi.mock("chalk", () => ({
  default: {
    blue: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    bold: (str: string) => str,
    dim: (str: string) => str,
    underline: (str: string) => str,
  },
}));

describe("search command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn<typeof console, "log">>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should display search results", async () => {
    const mockResults = [
      {
        title: "Abyssal whip",
        snippet: "A powerful weapon",
        url: "https://runescape.wiki/w/Abyssal_whip",
      },
      {
        title: "Abyssal demon",
        snippet: "A demon",
        url: "https://runescape.wiki/w/Abyssal_demon",
      },
    ];

    vi.mocked(wikiClient.searchWiki).mockResolvedValueOnce(mockResults);

    await search("abyssal", {});

    expect(wikiClient.searchWiki).toHaveBeenCalledWith("abyssal", {
      cache: {},
    });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("should handle empty results", async () => {
    vi.mocked(wikiClient.searchWiki).mockResolvedValueOnce([]);

    await search("nonexistent");

    // Should output "No results found."
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("No results found");
  });
});
