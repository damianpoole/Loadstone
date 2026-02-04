import chalk from "chalk";
import { searchWiki } from "@loadstone/wiki-client";
import { buildCacheOptions, type CacheCliOptions } from "./cache-options";

export async function search(query: string, options: CacheCliOptions = {}) {
  console.log(chalk.blue(`Searching RuneScape 3 Wiki for: ${query}...`));
  const cacheOptions = buildCacheOptions(options);
  const results = await searchWiki(query, { cache: cacheOptions });

  if (results.length === 0) {
    console.log(chalk.yellow("No results found."));
    return;
  }

  console.log(chalk.green(`Found ${results.length} results:`));
  results.forEach((result) => {
    console.log(`- ${chalk.bold(result.title)}`);
    if (result.snippet) {
      console.log(`  ${chalk.dim(result.snippet)}`);
    }
    console.log(`  ${chalk.underline(result.url)}`);
    console.log(""); // Empty line for spacing
  });
}
