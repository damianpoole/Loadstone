import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render } from "ink-testing-library";
import { Box } from "ink";
import { CommandMenu, matchingCommands, slashCommands } from "./slash-commands";
import { HELP } from "./controller";

afterEach(cleanup);

describe("slash commands", () => {
  it("lists every documented command, including help, without duplicates", () => {
    const documented = new Set(HELP.match(/(?<=^|\s)\/[a-z]+/gm));
    documented.add("/help");
    expect(new Set(slashCommands.map((command) => command.name))).toEqual(documented);
    expect(new Set(slashCommands.map((command) => command.name)).size).toBe(slashCommands.length);
  });

  it("filters command prefixes but not chat or arguments", () => {
    expect(matchingCommands("/")).toEqual(slashCommands);
    expect(matchingCommands("/mo").map((command) => command.name)).toEqual(["/model", "/models"]);
    expect(matchingCommands("/SY")[0]?.name).toBe("/sync");
    for (const input of ["", "hello /sync", "/missing", "/sync ", "/character Name"])
      expect(matchingCommands(input)).toEqual([]);
  });

  it("keeps the selected item visible in a bounded overlay", () => {
    const ui = render(
      <Box width={80} height={6}>
        <CommandMenu
          completion={{ matches: slashCommands, selected: 23, select: () => {}, dismiss: () => {} }}
          height={6}
        />
      </Box>,
    );
    expect(ui.lastFrame()).toContain("› /quit");
    expect(ui.lastFrame()).toContain("24/24");
    expect(ui.lastFrame()).not.toContain("/help");
    expect(ui.lastFrame()!.split("\n").length).toBeLessThanOrEqual(6);
  });
});
