import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchWiki, getPage, getCategoryMembers, getRSProfile } from "./index";

// Mock fetch globally
global.fetch = vi.fn() as unknown as typeof fetch;

const suppressConsoleErrors = () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
};

describe("searchWiki", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppressConsoleErrors();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return search results", async () => {
    const mockResponse = {
      query: {
        search: [
          {
            title: "Abyssal whip",
            snippet: "A powerful <em>weapon</em>",
          },
          {
            title: "Abyssal demon",
            snippet: "A demon",
          },
        ],
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const results = await searchWiki("abyssal");

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Abyssal whip");
    expect(results[0].snippet).toBe("A powerful weapon");
    expect(results[0].url).toContain("Abyssal_whip");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should handle API errors gracefully", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
    });

    const results = await searchWiki("test");

    expect(results).toEqual([]);
  });

  it("should handle network errors", async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

    const results = await searchWiki("test");

    expect(results).toEqual([]);
  });

  it("should strip HTML from snippets", async () => {
    const mockResponse = {
      query: {
        search: [
          {
            title: "Test",
            snippet: "Text with <em>emphasis</em> and <strong>bold</strong>",
          },
        ],
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const results = await searchWiki("test");

    expect(results[0].snippet).toBe("Text with emphasis and bold");
  });
});

describe("getPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppressConsoleErrors();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return page content in JSON mode", async () => {
    const mockResponse = {
      parse: {
        title: "Abyssal whip",
        pageid: 12345,
        revid: 67890,
        text: {
          "*": '<div class="mw-parser-output"><h2>Stats</h2><p>Content</p></div>',
        },
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getPage("Abyssal whip", { json: true });

    expect(result).toBeDefined();
    expect((result as any).title).toBe("Abyssal whip");
    expect((result as any).extract).toContain("Stats");
  });

  it("should return parsed text in non-JSON mode", async () => {
    const mockResponse = {
      parse: {
        title: "Test Page",
        text: {
          "*": '<div class="mw-parser-output"><h2>Section</h2><p>Content</p></div>',
        },
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getPage("Test Page", { json: false });

    expect(typeof result).toBe("string");
    expect(result).toContain("Section");
    expect(result).toContain("Content");
  });

  it("should filter sections when section option is provided", async () => {
    const mockResponse = {
      parse: {
        title: "Test Page",
        text: {
          "*": '<div class="mw-parser-output"><h2>Drop sources</h2><p>Drops</p><h2>Stats</h2><p>Stats</p></div>',
        },
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getPage("Test Page", { json: false, section: "Drop" });

    expect(result).toContain("Drop sources");
    expect(result).toContain("Drops");
    expect(result).not.toContain("Stats");
  });

  it("should return null for non-existent pages", async () => {
    const mockResponse = {
      error: {
        code: "missingtitle",
        info: "The page does not exist",
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await getPage("NonExistentPage", {});

    expect(result).toBeNull();
  });

  it("should handle API errors", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: "Server Error",
    });

    const result = await getPage("Test", {});

    expect(result).toBeNull();
  });
});

describe("getCategoryMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppressConsoleErrors();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return category members", async () => {
    const mockResponse = {
      query: {
        categorymembers: [
          { title: "Quest 1" },
          { title: "Quest 2" },
          { title: "Quest 3" },
        ],
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const members = await getCategoryMembers("Novice quests");

    expect(members).toHaveLength(3);
    expect(members).toContain("Quest 1");
    expect(members).toContain("Quest 2");
    expect(members).toContain("Quest 3");
  });

  it("should add Category: prefix if missing", async () => {
    const mockResponse = {
      query: {
        categorymembers: [],
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await getCategoryMembers("Novice quests");

    const fetchCall = (global.fetch as any).mock.calls[0][0];
    // Check that Category: prefix is added (URL encoded - space becomes + or %20)
    expect(fetchCall).toMatch(/Category%3ANovice[\s+%20]quests/);
  });

  it("should respect limit option", async () => {
    const mockResponse = {
      query: {
        categorymembers: [],
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await getCategoryMembers("Test", { limit: 10 });

    const fetchCall = (global.fetch as any).mock.calls[0][0];
    expect(fetchCall).toContain("cmlimit=10");
  });

  it("should handle API errors gracefully", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: "Not Found",
    });

    const members = await getCategoryMembers("Test");

    expect(members).toEqual([]);
  });

  it("should handle network errors", async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

    const members = await getCategoryMembers("Test");

    expect(members).toEqual([]);
  });
});

describe("getRSProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppressConsoleErrors();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return profile data", async () => {
    const mockProfileResponse = {
      name: "TestUser",
      combatlevel: 138,
      totalskill: 2595,
      totalxp: 5000000,
      questscomplete: 50,
      questsstarted: 5,
      questsnotstarted: 10,
      skillvalues: [
        { id: 0, level: 99, xp: 13034431, rank: 1000 },
        { id: 1, level: 80, xp: 5000000, rank: 2000 },
      ],
    };

    const mockQuestsResponse = {
      quests: [
        {
          title: "Test Quest",
          status: "COMPLETED",
          questPoints: 5,
          members: true,
        },
      ],
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfileResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuestsResponse,
      });

    const profile = await getRSProfile("TestUser");

    expect(profile).toBeDefined();
    expect(profile?.name).toBe("TestUser");
    expect(profile?.combatLevel).toBe(138);
    expect(profile?.totalSkill).toBe(2595);
    expect(profile?.skills.Attack).toBe(99);
    expect(profile?.skills.Defence).toBe(80);
    expect(profile?.quests).toHaveLength(1);
    expect(profile?.quests[0].title).toBe("Test Quest");
  });

  it("should handle missing quests data gracefully", async () => {
    const mockProfileResponse = {
      name: "TestUser",
      combatlevel: 138,
      totalskill: 2595,
      totalxp: 5000000,
      questscomplete: 50,
      questsstarted: 5,
      questsnotstarted: 10,
      skillvalues: [{ id: 0, level: 99, xp: 13034431, rank: 1000 }],
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfileResponse,
      })
      .mockResolvedValueOnce({
        ok: false,
        statusText: "Private",
      });

    const profile = await getRSProfile("TestUser");

    expect(profile).toBeDefined();
    expect(profile?.quests).toEqual([]);
  });

  it("should return null for non-existent profiles", async () => {
    const mockResponse = {
      error: "PROFILE_PRIVATE",
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const profile = await getRSProfile("NonExistentUser");

    expect(profile).toBeNull();
  });

  it("should handle API errors", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: "Server Error",
    });

    const profile = await getRSProfile("TestUser");

    expect(profile).toBeNull();
  });

  it("should map all skill IDs correctly", async () => {
    const mockProfileResponse = {
      name: "TestUser",
      combatlevel: 138,
      totalskill: 2595,
      totalxp: 5000000,
      questscomplete: 0,
      questsstarted: 0,
      questsnotstarted: 0,
      skillvalues: [
        { id: 0, level: 1, xp: 0, rank: 0 },
        { id: 28, level: 99, xp: 0, rank: 0 }, // Necromancy
      ],
    };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockProfileResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quests: [] }),
      });

    const profile = await getRSProfile("TestUser");

    expect(profile?.skills.Attack).toBe(1);
    expect(profile?.skills.Necromancy).toBe(99);
  });
});
