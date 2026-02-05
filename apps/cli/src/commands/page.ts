import chalk from "chalk";
import { getPage, parseWikiContent } from "@loadstone/wiki-client";
import { buildCacheOptions, type CacheCliOptions } from "./cache-options";

export async function page(
  title: string,
  options: {
    json?: boolean;
    section?: string;
    headings?: boolean;
    fields?: string;
  } & CacheCliOptions = {},
) {
  if (!options.json) {
    console.log(chalk.blue(`Fetching content for: ${title}...`));
  }
  const cacheOptions = buildCacheOptions(options);
  // We always ask for JSON=true from the client to get the full metadata object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await getPage(title, {
    json: true,
    section: options.section,
    cache: cacheOptions,
  })) as any;

  if (!data || data.error) {
    if (options.json) {
      console.log(JSON.stringify({ error: "Page not found" }, null, 2));
    } else {
      console.log(chalk.red("Page not found."));
    }
    return;
  }

  // With action=parse, the data structure is flat in the return object from getPage
  // (because getPage unwraps data.parse)

  if (options.json) {
    const requestedSections = options.fields
      ? options.fields
          .split(",")
          .map((field) => field.trim())
          .filter((field) => field.length > 0)
      : [];

    // The 'extract' here is the raw HTML
    const rawHtml = data.extract || "";
    let structuredContent = parseWikiContent(rawHtml);

    // Filter sections if requested
    if (options.section) {
      const filtered: Record<string, string> = {};
      const key = Object.keys(structuredContent).find((k) =>
        k.toLowerCase().includes(options.section!.toLowerCase()),
      );
      if (key) {
        filtered[key] = structuredContent[key];
        structuredContent = filtered;
      } else {
        // If not found, return empty sections but with metadata
        structuredContent = {};
      }
    }

    if (requestedSections.length > 0) {
      const filtered: Record<string, string> = {};
      const sectionKeys = Object.keys(structuredContent);
      for (const requested of requestedSections) {
        const requestedLower = requested.toLowerCase();
        const exactMatch = sectionKeys.find(
          (key) => key.toLowerCase() === requestedLower,
        );
        const fuzzyMatch = exactMatch
          ? null
          : sectionKeys.find((key) =>
              key.toLowerCase().includes(requestedLower),
            );
        const matchKey = exactMatch ?? fuzzyMatch;
        if (matchKey) {
          filtered[matchKey] = structuredContent[matchKey];
        }
      }
      structuredContent = filtered;
    }

    const sections = options.headings
      ? Object.keys(structuredContent)
      : structuredContent;

    const result = {
      title: data.title,
      pageId: data.pageid,
      url: `https://runescape.wiki/w/${encodeURIComponent(
        data.title.replace(/ /g, "_"),
      )}`,
      lastModified: data.revid,
      sections,
    };

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Text mode output (re-using the logic from getPage which returns string if json=false)
  // But here we called it with json=true.
  const rawHtml = data.extract || "";
  const sections = parseWikiContent(rawHtml);

  if (options.section) {
    const key = Object.keys(sections).find((k) =>
      k.toLowerCase().includes(options.section!.toLowerCase()),
    );
    if (key) {
      console.log(chalk.bold.green(`\n=== ${key} ===\n`));
      console.log(sections[key]);
    } else {
      console.log(chalk.red(`Section '${options.section}' not found.`));
      console.log(
        chalk.dim(`Available sections: ${Object.keys(sections).join(", ")}`),
      );
    }
    return;
  }

  console.log(chalk.bold.green(`\n=== ${data.title} ===\n`));
  for (const [sectionTitle, content] of Object.entries(sections)) {
    console.log(chalk.bold(`\n== ${sectionTitle} ==\n`));
    console.log(content);
  }
}
