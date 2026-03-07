import "@testing-library/jest-dom/vitest";

import { render, cleanup, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type MockTerminalInstance = {
  onDataHandler?: (data: string) => void;
  onResizeHandler?: (size: { cols: number; rows: number }) => void;
  onTitleChangeHandler?: (title: string) => void;
  write: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
  onTitleChange: ReturnType<typeof vi.fn>;
};

const {
  terminalSpy,
  terminalInstances,
  mockUseTerminalOutput,
  outputCallbacksBySession,
  writeInputMock,
  resizeSessionMock
} = vi.hoisted(() => {
  const terminalInstances: MockTerminalInstance[] = [];
  const outputCallbacksBySession = new Map<string, (data: string) => void>();

  const terminalSpy = vi.fn(() => {
    const instance: MockTerminalInstance = {
      write: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      open: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn((handler: (data: string) => void) => {
        instance.onDataHandler = handler;
      }),
      onResize: vi.fn((handler: (size: { cols: number; rows: number }) => void) => {
        instance.onResizeHandler = handler;
      }),
      onTitleChange: vi.fn((handler: (title: string) => void) => {
        instance.onTitleChangeHandler = handler;
      })
    };

    terminalInstances.push(instance);
    return instance;
  });

  const mockUseTerminalOutput = vi.fn((sessionId: string, callback: (data: string) => void) => {
    outputCallbacksBySession.set(sessionId, callback);
  });

  const writeInputMock = vi.fn().mockResolvedValue(undefined);
  const resizeSessionMock = vi.fn().mockResolvedValue(undefined);

  return {
    terminalSpy,
    terminalInstances,
    mockUseTerminalOutput,
    outputCallbacksBySession,
    writeInputMock,
    resizeSessionMock
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: terminalSpy
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn()
  }))
}));

vi.mock("../hooks/useTerminal", () => ({
  useTerminalOutput: mockUseTerminalOutput,
  createTerminalClient: vi.fn().mockReturnValue({
    writeInput: writeInputMock,
    resizeSession: resizeSessionMock
  })
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
  writable: true
});

describe("TerminalInstance", () => {
  beforeEach(() => {
    mockFonts.reset();
    mockFonts.setCheckResult(true);
    terminalSpy.mockClear();
    terminalInstances.length = 0;
    outputCallbacksBySession.clear();
    writeInputMock.mockClear();
    resizeSessionMock.mockClear();
    mockUseTerminalOutput.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("initializes terminal when font is already loaded", async () => {
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

  it("passes fontFamily starting with VibetreeNerdMono to Terminal constructor", async () => {
    render(
      <TerminalInstance
        sessionId="test-session"
        isActive={true}
        onTitleChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(terminalSpy).toHaveBeenCalled();
      const firstCall = terminalSpy.mock.calls[0] as unknown[];
      const terminalCall = (firstCall?.[0] ?? {}) as { fontFamily?: string };
      expect(terminalCall.fontFamily).toMatch(/^"?VibetreeNerdMono/);
    });
  });

  it("fires prompt-ready exactly once after Enter and debounce", async () => {
    const onPromptReady = vi.fn();

    render(
      <TerminalInstance
        sessionId="session-1"
        isActive={true}
        onPromptReady={onPromptReady}
        attentionProfile={{
          id: "opencode",
          name: "OpenCode",
          prompt_regex: "(^|\\r?\\n)>\\s*$",
          attention_mode: "attention",
          debounce_ms: 10
        }}
      />
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const terminal = terminalInstances[0];
    const outputCb = outputCallbacksBySession.get("session-1");
    expect(outputCb).toBeTruthy();

    terminal.onDataHandler?.("\r");
    outputCb?.("\n> ");
    await sleep(25);

    outputCb?.("\n> ");
    await sleep(25);

    expect(onPromptReady).toHaveBeenCalledTimes(1);
  });

  it("does not fire prompt-ready without Enter", async () => {
    const onPromptReady = vi.fn();

    render(
      <TerminalInstance
        sessionId="session-1"
        isActive={true}
        onPromptReady={onPromptReady}
        attentionProfile={{
          id: "opencode",
          name: "OpenCode",
          prompt_regex: "(^|\\r?\\n)>\\s*$",
          attention_mode: "attention",
          debounce_ms: 10
        }}
      />
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const outputCb = outputCallbacksBySession.get("session-1");
    outputCb?.("\n> ");
    await sleep(25);

    expect(onPromptReady).not.toHaveBeenCalled();
  });

  it("disables prompt-ready detection when regex is invalid", async () => {
    const onPromptReady = vi.fn();

    render(
      <TerminalInstance
        sessionId="session-1"
        isActive={true}
        onPromptReady={onPromptReady}
        attentionProfile={{
          id: "custom",
          name: "Custom",
          prompt_regex: "(^|\\r?\\n)>\\s*",
          attention_mode: "attention",
          debounce_ms: 10
        }}
      />
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const terminal = terminalInstances[0];
    const outputCb = outputCallbacksBySession.get("session-1");
    terminal.onDataHandler?.("\r");
    outputCb?.("\n> ");
    await sleep(25);

    expect(onPromptReady).not.toHaveBeenCalled();
  });
});
