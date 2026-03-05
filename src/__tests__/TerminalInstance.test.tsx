import "@testing-library/jest-dom/vitest";

import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { terminalSpy } = vi.hoisted(() => ({
  terminalSpy: vi.fn((...args: unknown[]) => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    onTitleChange: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
  })),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: terminalSpy,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock("../hooks/useTerminal", () => ({
  useTerminalOutput: vi.fn(),
  createTerminalClient: vi.fn().mockReturnValue({
    writeInput: vi.fn().mockResolvedValue(undefined),
    resizeSession: vi.fn().mockResolvedValue(undefined),
  }),
}));

import TerminalInstance from "../components/TerminalInstance";

class MockFonts {
  private checkResult = false;
  private loadImpl: () => void;

  constructor() {
    this.loadImpl = () => {};
  }

  check(_font: string): boolean {
    return this.checkResult;
  }

  load(_font: string): Promise<void> {
    return new Promise((resolve) => {
      this.loadImpl = resolve;
    });
  }

  setCheckResult(result: boolean): void {
    this.checkResult = result;
  }

  resolveLoad(): void {
    this.loadImpl();
  }

  reset(): void {
    this.checkResult = false;
    this.loadImpl = () => {};
  }
}

const mockFonts = new MockFonts();

Object.defineProperty(document, "fonts", {
  value: mockFonts,
  writable: true,
});

describe("TerminalInstance", () => {
  beforeEach(() => {
    mockFonts.reset();
    terminalSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("initializes terminal when font is already loaded (check returns true)", async () => {
    mockFonts.setCheckResult(true);

    render(
      <TerminalInstance
        sessionId="test-session"
        isActive={true}
        onTitleChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(terminalSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("initializes terminal when font load resolves successfully", async () => {
    mockFonts.setCheckResult(false);

    render(
      <TerminalInstance
        sessionId="test-session"
        isActive={true}
        onTitleChange={vi.fn()}
      />
    );

    mockFonts.resolveLoad();

    await waitFor(() => {
      expect(terminalSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("initializes terminal when font load rejects", async () => {
    mockFonts.setCheckResult(false);

    let rejectLoad: (reason?: unknown) => void;
    vi.spyOn(document.fonts, "load").mockImplementation(
      () => new Promise((_, reject) => {
        rejectLoad = reject;
      })
    );

    render(
      <TerminalInstance
        sessionId="test-session"
        isActive={true}
        onTitleChange={vi.fn()}
      />
    );

    rejectLoad!(new Error("Font load failed"));

    await waitFor(() => {
      expect(terminalSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("initializes terminal when font load times out (2 second timeout)", async () => {
    mockFonts.setCheckResult(false);

    vi.useFakeTimers();

    render(
      <TerminalInstance
        sessionId="test-session"
        isActive={true}
        onTitleChange={vi.fn()}
      />
    );

    vi.advanceTimersByTime(2100);
    vi.useRealTimers();

    await waitFor(() => {
      expect(terminalSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("passes fontFamily starting with VibetreeNerdMono to Terminal constructor", async () => {
    mockFonts.setCheckResult(true);

    render(
      <TerminalInstance
        sessionId="test-session"
        isActive={true}
        onTitleChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(terminalSpy).toHaveBeenCalled();
      const terminalCall = terminalSpy.mock.calls[0][0] as { fontFamily?: string };
      expect(terminalCall.fontFamily).toMatch(/^"?VibetreeNerdMono/);
    });
  });
});
