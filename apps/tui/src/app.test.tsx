import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render, cleanup } from "ink-testing-library";
import { App, CharacterSidebar, plainText, screenLines } from "./app";
import type { AppState, Controller } from "./controller";

afterEach(cleanup);
const state: AppState = {
  facts: [],
  view: {
    messages: [{ id: "1", role: "Assistant", text: "Welcome Ironman" }],
    partial: "Streaming advice",
    busy: true,
    activity: ["search_wiki: running"],
    hasEarlier: false,
  },
  notice: "",
  processing: false,
  pending: 1,
};
it("strips terminal escape sequences while preserving readable text", () => {
  expect(plainText("\x1b[31mRed\x1b[0m\x1b]52;c;secret\x07\nText\x00")).toBe("Red\nText");
});
it("wraps chat for small terminals and labels item memory as last observed", () => {
  expect(screenLines(state, "chat", 20).every((line) => line.length <= 20)).toBe(true);
  const facts: AppState["facts"] = [
    {
      kind: "item",
      key: "whip",
      value: { owned: true },
      source: "user",
      observedAt: 1000,
      recordedAt: 1000,
      evidence: "reported",
      operationId: "one",
    },
  ];
  expect(screenLines({ ...state, facts }, "memory", 100).join("\n")).toContain("last observed");
});
describe("character sidebar", () => {
  it("shows the selected name and distinguishes synced statuses from reported progress", () => {
    const facts: AppState["facts"] = [
      {
        kind: "quest",
        key: "tai bwo wannai trio",
        value: "NOT_STARTED",
        source: "runemetrics",
        observedAt: 1,
        recordedAt: 3,
        evidence: "sync",
        operationId: "sync",
      },
      {
        kind: "skill",
        key: "herblore",
        value: 90,
        source: "user",
        observedAt: 1,
        recordedAt: 2,
        evidence: "reported",
        operationId: "report",
      },
      {
        kind: "quest",
        key: "druidic ritual",
        value: "COMPLETED",
        source: "runemetrics",
        observedAt: 1,
        recordedAt: 1,
        evidence: "sync",
        operationId: "sync",
      },
    ];
    const ui = render(
      <CharacterSidebar
        state={{
          ...state,
          character: { id: "iron", name: "My Iron", mode: "ironman", createdAt: 0 },
          facts,
        }}
      />,
    );
    const frame = ui.lastFrame()!;
    expect(frame).toContain("CHARACTER");
    expect(frame).toContain("My Iron");
    expect(frame).toContain("ironman");
    expect(frame).toContain("1 quests known complete");
    expect(frame).toContain("LAST SAVED FACTS");
    expect(frame).toContain("Includes sync, not activity");
    expect(frame).toContain("tai bwo wannai trio:");
    expect(frame.replace(/[│\s]+/g, " ")).toContain("NOT STARTED");
    expect(frame).toContain("RuneMetrics sync");
    expect(frame).toContain("User reported");
    expect(frame.indexOf("tai bwo wannai trio")).toBeLessThan(frame.indexOf("herblore"));
    expect(frame).not.toContain("RECENT MEMORY");
    expect(facts[0].value).toBe("NOT_STARTED");
  });
  it("has explicit empty states and strips controls from character names", async () => {
    const ui = render(<CharacterSidebar state={state} />);
    expect(ui.lastFrame()).toContain("No character selected");
    expect(ui.lastFrame()).toContain("No saved facts yet");
    ui.rerender(
      <CharacterSidebar
        state={{
          ...state,
          character: { id: "iron", name: "\x1b[31mMy Iron\x1b[0m", mode: "ironman", createdAt: 0 },
        }}
      />,
    );
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("My Iron"));
    expect(ui.lastFrame()).not.toContain("\x1b[31m");
  });
});
describe("Ink screen", () => {
  it("scrolls long responses with arrows, pages, Home/End and the mouse without editing the draft", async () => {
    let current: AppState = {
      ...state,
      view: {
        ...state.view,
        partial: "",
        messages: [
          {
            id: "long",
            role: "Assistant",
            text: Array.from(
              { length: 120 },
              (_, i) => `Response line ${String(i).padStart(3, "0")}`,
            ).join("\n"),
          },
        ],
      },
    };
    let notify = () => {};
    const execute = vi.fn();
    const controller = {
      snapshot: () => current,
      subscribe: (listener: () => void) => {
        notify = listener;
        return () => {};
      },
      execute,
      cancel: vi.fn(),
      report: vi.fn(),
    } as unknown as Controller;
    const ui = render(<App controller={controller} onQuit={vi.fn()} />);
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("Response line 119"));
    ui.stdin.write("draft");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("draft"));
    ui.stdin.write("\x1b[5~");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("Lines "));
    expect(ui.lastFrame()).not.toContain("Response line 119");
    const page = ui.lastFrame();
    ui.stdin.write("\x1b[A");
    await vi.waitFor(() => expect(ui.lastFrame()).not.toBe(page));
    ui.stdin.write("\x1b[H");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("Response line 000"));
    // Appending streamed content must not drag a scrolled viewport down.
    current = {
      ...current,
      view: {
        ...current.view,
        partial: Array.from({ length: 20 }, (_, i) => `New streaming line ${i}`).join("\n"),
      },
    };
    notify();
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("of 141"));
    expect(ui.lastFrame()).toContain("Response line 000");
    ui.stdin.write("\x1b[<65;12;8M");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("Lines 4–"));
    expect(ui.lastFrame()).not.toContain("Response line 000");
    // Fragmented wheel-up report is assembled by Ink before dispatch.
    ui.stdin.write("\x1b[<64;");
    ui.stdin.write("12;8M");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("Response line 000"));
    ui.stdin.write("\x1b[F");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("New streaming line 19"));
    ui.stdin.write("\x1b[5~");
    await vi.waitFor(() => expect(ui.lastFrame()).not.toContain("New streaming line 19"));
    ui.stdin.write("\x1b[6~");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("New streaming line 19"));
    ui.stdin.write("\r");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith("draft"));
  });
  it("renders streaming/tool state and handles chat, tabs, cancellation and quit", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn();
    const controller = {
      snapshot: () => state,
      subscribe: () => () => {},
      execute,
      cancel,
      report: vi.fn(),
    } as unknown as Controller;
    const ui = render(<App controller={controller} onQuit={quit} />);
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("Streaming advice"));
    expect(ui.lastFrame()).toContain("search_wiki: running");
    expect(ui.lastFrame()).toContain("1 pending");
    ui.stdin.write("hello");
    await new Promise((resolve) => setTimeout(resolve, 30));
    ui.stdin.write("\r");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith("hello"));
    ui.stdin.write("\t");
    await vi.waitFor(() => expect(ui.lastFrame()).toContain("No memory yet"));
    ui.stdin.write("\x1b");
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    ui.stdin.write("\x03");
    await vi.waitFor(() => expect(quit).toHaveBeenCalled());
  });
});
