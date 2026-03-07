import { beforeEach, describe, expect, it, vi } from "vitest";

import { PromptReadyTracker, appendTail, compilePromptRegex, stripAnsi } from "../terminal/promptReady";

describe("promptReady", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("arms only on Enter", () => {
    const onReady = vi.fn();
    const tracker = new PromptReadyTracker({
      promptRegex: /(^|\r?\n)>\s*$/,
      onReady
    });

    tracker.onUserInput("abc");
    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(300);
    expect(onReady).not.toHaveBeenCalled();

    tracker.onUserInput("\r");
    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(300);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("prompt match without arming does not fire", () => {
    const onReady = vi.fn();
    const tracker = new PromptReadyTracker({
      promptRegex: /(^|\r?\n)>\s*$/,
      onReady
    });

    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(400);

    expect(onReady).not.toHaveBeenCalled();
  });

  it("debounce cancels with intervening output", () => {
    const onReady = vi.fn();
    const tracker = new PromptReadyTracker({
      promptRegex: /(^|\r?\n)>\s*$/,
      onReady,
      debounceMs: 300
    });

    tracker.onUserInput("\r");
    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(150);
    tracker.onTerminalOutput("working...");
    vi.advanceTimersByTime(300);

    expect(onReady).not.toHaveBeenCalled();
  });

  it("one-shot latch after fire", () => {
    const onReady = vi.fn();
    const tracker = new PromptReadyTracker({
      promptRegex: /(^|\r?\n)>\s*$/,
      onReady,
      debounceMs: 300
    });

    tracker.onUserInput("\r");
    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(350);

    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(350);
    expect(onReady).toHaveBeenCalledTimes(1);

    tracker.onUserInput("x");
    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(350);
    expect(onReady).not.toHaveBeenCalledTimes(2);

    tracker.onUserInput("\r");
    tracker.onTerminalOutput("\n> ");
    vi.advanceTimersByTime(350);
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it("ANSI-colored prompt matches", () => {
    const onReady = vi.fn();
    const tracker = new PromptReadyTracker({
      promptRegex: /(^|\r?\n)>\s*$/,
      onReady,
      debounceMs: 300
    });

    tracker.onUserInput("\r");
    tracker.onTerminalOutput("\n\u001b[32m>\u001b[0m ");
    vi.advanceTimersByTime(350);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("supports helper functions", () => {
    expect(stripAnsi("\u001b[31mhello\u001b[0m")).toBe("hello");
    expect(appendTail("abc", "def", 4)).toBe("cdef");
    expect(compilePromptRegex("(^|\\r?\\n)>\\s*$")).toEqual({
      ok: true,
      regex: /(^|\r?\n)>\s*$/
    });
    expect(compilePromptRegex("^> ")).toEqual({
      ok: false,
      error: "Prompt regex must be end-anchored with $."
    });
  });
});
