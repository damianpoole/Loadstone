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
    const fieldMap: Record<
      string,
      "title" | "pageId" | "url" | "lastModified" | "sections"
    > = {
      title: "title",
      pageid: "pageId",
      pageId: "pageId",
      url: "url",
      lastmodified: "lastModified",
      lastModified: "lastModified",
      sections: "sections",
    };
    const requestedFields = options.fields
      ? new Set(
          options.fields
            .split(",")
            .map((field) => field.trim())
            .filter((field) => field.length > 0)
            .map((field) => fieldMap[field] || fieldMap[field.toLowerCase()])
            .filter(
              (
                field,
              ): field is
                | "title"
                | "pageId"
                | "url"
                | "lastModified"
                | "sections" => Boolean(field),
            ),
        )
      : null;
    const includeField = (
      field: "title" | "pageId" | "url" | "lastModified" | "sections",
    ) => !requestedFields || requestedFields.has(field);

    let sections: Record<string, string> | string[] | undefined;
    if (includeField("sections")) {
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

      sections = options.headings
        ? Object.keys(structuredContent)
        : structuredContent;
    }

    const result: Record<string, unknown> = {};
    if (includeField("title")) {
      result.title = data.title;
    }
    if (includeField("pageId")) {
      result.pageId = data.pageid;
    }
    if (includeField("url")) {
      result.url = `https://runescape.wiki/w/${encodeURIComponent(
        data.title.replace(/ /g, "_"),
      )}`;
    }
    if (includeField("lastModified")) {
      result.lastModified = data.revid;
    }
    if (includeField("sections")) {
      result.sections = sections ?? (options.headings ? [] : {});
    }

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
