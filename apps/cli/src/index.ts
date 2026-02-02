import { Command } from "commander";
import { search } from "./commands/search";
import { page } from "./commands/page";
import { category } from "./commands/category";
import { profile } from "./commands/profile";
import { version } from "../package.json";

const program = new Command();

program
  .name("loadstone")
  .description("CLI for accessing the RuneScape 3 Wiki")
  .version(version);

program
  .command("search")
  .description("Search the wiki for a term")
  .argument("<query>", "The term to search for")
  .action(search);

program
  .command("page")
  .description("Get the content of a specific page")
  .argument("<title>", "The title of the page")
  .option("-j, --json", "Output results as JSON")
  .option("-s, --section <name>", "Filter output to a specific section (fuzzy match)")
  .action(page);

program
  .command("category")
  .description("Get members of a wiki category")
  .argument("<name>", "The name of the category")
  .option("-j, --json", "Output results as JSON")
  .option("-l, --limit <number>", "Limit the number of results", "50")
  .action(category);

program
  .command("profile")
  .description("Get player profile from RuneMetrics")
  .argument("<username>", "The RuneScape username")
  .option("-j, --json", "Output results as JSON")
  .option("-q, --quests", "Include full quest list in output")
  .action(profile);

program.parse();
