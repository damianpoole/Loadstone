import * as cheerio from "cheerio";

export interface SearchResult {
  title: string;
  snippet?: string;
  url: string;
}

const BASE_URL = "https://runescape.wiki/api.php";

/**
 * Searches the RuneScape 3 Wiki for a given term.
 * @param query The search term.
 * @returns A list of search results.
 */
export async function searchWiki(query: string): Promise<SearchResult[]> {
  const url = new URL(BASE_URL);
  url.searchParams.append("action", "query");
  url.searchParams.append("list", "search");
  url.searchParams.append("srsearch", query);
  url.searchParams.append("srlimit", "5");
  url.searchParams.append("format", "json");

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Wiki API error: ${response.statusText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as any;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = data.query?.search || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.map((result: any) => ({
      title: result.title,
      // Snippet contains HTML highlighting, we strip it roughly for display
      snippet: result.snippet?.replace(/<[^>]+>/g, ""), 
      url: `https://runescape.wiki/w/${encodeURIComponent(result.title.replace(/ /g, "_"))}`,
    }));
  } catch (error) {
    console.error("Failed to fetch from wiki:", error);
    return [];
  }
}

/**
 * Fetches the parsed content of a specific wiki page.
 * @param title The title of the page to fetch.
 * @param options Configuration options.
 * @returns The page content or raw data, or null if not found.
 */
export async function getPage(title: string, options: { json?: boolean; section?: string } = {}): Promise<string | object | null> {
  const url = new URL(BASE_URL);
  url.searchParams.append("action", "parse");
  url.searchParams.append("format", "json");
  url.searchParams.append("prop", "text|properties|displaytitle|revid");
  url.searchParams.append("page", title);
  url.searchParams.append("redirects", "1");

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Wiki API error: ${response.statusText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as any;
    
    if (data.error) {
      return null;
    }

    // In 'parse' action, the data is directly under data.parse
    const parseData = data.parse;
    
    if (options.json) {
      // Return the raw parse data, but we'll likely want to inject the parsed text later
      // The CLI handles the calling of parseWikiContent, so we pass the raw HTML here
      return {
        ...parseData,
        // We ensure we return the HTML text so the CLI can parse it
        extract: parseData.text["*"]
      };
    }

    // For text mode, we parse it immediately
    const sections = parseWikiContent(parseData.text["*"]);
    
    // Filter sections if requested
    if (options.section) {
      const filtered: Record<string, string> = {};
      const key = Object.keys(sections).find(k => k.toLowerCase().includes(options.section!.toLowerCase()));
      if (key) {
        filtered[key] = sections[key];
        // Also format output for just this section
        return `\n=== ${key} ===\n${sections[key]}\n`;
      } else {
        return `Section '${options.section}' not found. Available sections: ${Object.keys(sections).join(", ")}`;
      }
    }

    // Reconstruct a simple text representation
    let output = "";
    for (const [key, value] of Object.entries(sections)) {
      output += `\n=== ${key} ===\n${value}\n`;
    }
    return output.trim();

  } catch (error) {
    console.error("Failed to fetch page:", error);
    return null;
  }
}

/**
 * Parses raw HTML into a structured object based on headers.
 * Uses cheerio to traverse the DOM.
 * @param html The raw wiki HTML.
 * @returns A key-value pair of section titles and their content.
 */
export function parseWikiContent(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const sections: Record<string, string> = {};
  
  // Clean up noise before parsing
  // Remove style blocks, scripts, and navigation boxes (which add huge token overhead)
  $("style").remove();
  $("script").remove();
  $("noscript").remove();
  $(".navbox").remove(); // Remove navigation templates at the bottom
  $(".mw-editsection").remove(); // Remove [edit] links from headers
  $(".magnify").remove(); // Remove 'magnify' icon text from images

  // The summary is everything before the first h2
  // We'll traverse from the root
  let currentSection = "Summary";
  let currentContent: string[] = [];
  
  // Helper to convert an element to text, handling tables specifically
  const getText = (el: cheerio.AnyNode): string => {
    const node = $(el);
    
    // Handle Tables: Try to make them CSV-like or readable
    if (node.is("table")) {
       let tableText = "\n";
       node.find("tr").each((_, tr) => {
         const row: string[] = [];
         $(tr).find("th, td").each((_, cell) => {
           row.push($(cell).text().trim().replace(/\s+/g, " ")); // clean whitespace
         });
         if (row.length > 0) {
             tableText += row.join(" | ") + "\n";
         }
       });
       return tableText;
    }

    // Handle Lists
    if (node.is("ul") || node.is("ol")) {
        let listText = "\n";
        node.children("li").each((_, li) => {
            listText += `• ${$(li).text().trim()}\n`;
        });
        return listText;
    }

    return node.text().trim();
  };

  // Iterate over all children of the parser output wrapper
  // MediaWiki usually wraps content in <div class="mw-parser-output">
  const root = $(".mw-parser-output").length ? $(".mw-parser-output") : $.root();

  root.children().each((_, el) => {
    const node = $(el);

    if (node.is("h2")) {
      // Save previous section
      if (currentContent.length > 0) {
        const text = currentContent.join("\n").trim();
        if (text) sections[currentSection] = text;
      }
      
      // Start new section
      // Remove 'edit' links usually found in headers
      currentSection = node.text().replace(/ \[edit \| edit source\]/g, "").replace(/ \[edit\]/g, "").trim();
      currentContent = [];
    } else if (node.is("h3") || node.is("h4")) {
      // Add subheaders as text
      const subHeader = node.text().replace(/ \[edit \| edit source\]/g, "").replace(/ \[edit\]/g, "").trim();
      currentContent.push(`\n=== ${subHeader} ===`);
    } else {
      // Add content
      const text = getText(el);
      if (text) currentContent.push(text);
    }
  });

  // Save the last section
  if (currentContent.length > 0) {
    const text = currentContent.join("\n").trim();
    if (text) sections[currentSection] = text;
  }

      return sections;

  }

  

  /**

   * Fetches the members of a specific wiki category.

   * @param category The category name (e.g., "Category:Novice quests").

   * @param options Configuration options.

   * @returns A list of page titles in the category.

   */

  export async function getCategoryMembers(category: string, options: { limit?: number } = {}): Promise<string[]> {

    const url = new URL(BASE_URL);

    url.searchParams.append("action", "query");

    url.searchParams.append("format", "json");

    url.searchParams.append("list", "categorymembers");

    url.searchParams.append("cmtitle", category.startsWith("Category:") ? category : `Category:${category}`);

    url.searchParams.append("cmlimit", (options.limit || 50).toString());

  

    try {

      const response = await fetch(url.toString());

      if (!response.ok) {

        throw new Error(`Wiki API error: ${response.statusText}`);

      }

  

      // eslint-disable-next-line @typescript-eslint/no-explicit-any

      const data = await response.json() as any;

      const members = data.query?.categorymembers || [];

      

          // eslint-disable-next-line @typescript-eslint/no-explicit-any

      

          return members.map((member: any) => member.title);

      

        } catch (error) {

      

          console.error("Failed to fetch category members:", error);

      

          return [];

      

        }

      

      }

      

      

      

      const SKILL_NAMES: Record<number, string> = {

      

        0: "Attack",

      

        1: "Defence",

      

        2: "Strength",

      

        3: "Constitution",

      

        4: "Ranged",

      

        5: "Prayer",

      

        6: "Magic",

      

        7: "Cooking",

      

        8: "Woodcutting",

      

        9: "Fletching",

      

        10: "Fishing",

      

        11: "Firemaking",

      

        12: "Crafting",

      

        13: "Smithing",

      

        14: "Mining",

      

        15: "Herblore",

      

        16: "Agility",

      

        17: "Thieving",

      

        18: "Slayer",

      

        19: "Farming",

      

        20: "Runecrafting",

      

        21: "Hunter",

      

        22: "Construction",

      

        23: "Summoning",

      

        24: "Dungeoneering",

      

        25: "Divination",

      

        26: "Invention",

      

        27: "Archaeology",

      

        28: "Necromancy",

      

      };

      

      

      

      export interface SkillValue {

      

        level: number;

      

        xp: number;

      

        rank: number;

      

        id: number;

      

        name: string;

      

      }

      

      

      

      export interface RSProfile {

      

      

      

        name: string;

      

      

      

        combatLevel: number;

      

      

      

        totalSkill: number;

      

      

      

        totalXp: number;

      

      

      

        questsComplete: number;

      

      

      

        questsStarted: number;

      

      

      

        questsNotStarted: number;

      

      

      

        skills: Record<string, number>;

      

      

      

        quests: {

      

      

      

          title: string;

      

      

      

          status: "COMPLETED" | "STARTED" | "NOT_STARTED";

      

      

      

          questPoints: number;

      

      

      

          members: boolean;

      

      

      

        }[];

      

      

      

        raw?: any;

      

      

      

      }

      

      

      

      

      

      

      

      /**

      

      

      

       * Fetches the RuneMetrics profile for a given user.

      

      

      

       * @param username The RuneScape username.

      

      

      

       * @returns The structured profile data.

      

      

      

       */

      

      

      

      export async function getRSProfile(username: string): Promise<RSProfile | null> {

      

      

      

        const profileUrl = `https://apps.runescape.com/runemetrics/profile/profile?user=${encodeURIComponent(username)}&skillvalues`;

      

      

      

        const questsUrl = `https://apps.runescape.com/runemetrics/quests?user=${encodeURIComponent(username)}`;

      

      

      

      

      

      

      

        try {

      

      

      

          const [profileRes, questsRes] = await Promise.all([

      

      

      

            fetch(profileUrl),

      

      

      

            fetch(questsUrl)

      

      

      

          ]);

      

      

      

      

      

      

      

          if (!profileRes.ok) throw new Error(`RuneMetrics profile error: ${profileRes.statusText}`);

      

      

      

          // Quests might fail if private, but we can tolerate that

      

      

      

          

      

      

      

          // eslint-disable-next-line @typescript-eslint/no-explicit-any

      

      

      

          const profileData = await profileRes.json() as any;

      

      

      

          if (profileData.error) return null;

      

      

      

      

      

      

      

          // eslint-disable-next-line @typescript-eslint/no-explicit-any

      

      

      

          let questsData: any = { quests: [] };

      

      

      

          if (questsRes.ok) {

      

      

      

            questsData = await questsRes.json();

      

      

      

          }

      

      

      

      

      

      

      

          const skills: Record<string, number> = {};

      

      

      

          // eslint-disable-next-line @typescript-eslint/no-explicit-any

      

      

      

          profileData.skillvalues.forEach((sv: any) => {

      

      

      

            const name = SKILL_NAMES[sv.id] || `Unknown(${sv.id})`;

      

      

      

            skills[name] = sv.level;

      

      

      

          });

      

      

      

      

      

      

      

          return {

      

      

      

            name: profileData.name,

      

      

      

            combatLevel: profileData.combatlevel,

      

      

      

            totalSkill: profileData.totalskill,

      

      

      

            totalXp: profileData.totalxp,

      

      

      

            questsComplete: profileData.questscomplete,

      

      

      

            questsStarted: profileData.questsstarted,

      

      

      

            questsNotStarted: profileData.questsnotstarted,

      

      

      

            skills,

      

      

      

            // eslint-disable-next-line @typescript-eslint/no-explicit-any

      

      

      

            quests: (questsData.quests || []).map((q: any) => ({

      

      

      

              title: q.title,

      

      

      

              status: q.status,

      

      

      

              questPoints: q.questPoints,

      

      

      

              members: q.members

      

      

      

            })),

      

      

      

            raw: profileData,

      

      

      

          };

      

      

      

        } catch (error) {

      

      

      

          console.error("Failed to fetch RuneMetrics profile:", error);

      

      

      

          return null;

      

      

      

        }

      

      

      

      }

      

      

      

      

      

      

  
