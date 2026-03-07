type CompileResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: string };

type PromptReadyOptions = {
  promptRegex: RegExp;
  debounceMs?: number;
  tailMaxChars?: number;
  onReady: () => void;
};

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_TAIL_MAX_CHARS = 4096;

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[@-_]/g, "");
}

export function appendTail(prev: string, next: string, maxChars: number): string {
  const merged = prev + next;
  if (merged.length <= maxChars) {
    return merged;
  }
  return merged.slice(-maxChars);
}

export function compilePromptRegex(pattern: string): CompileResult {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Prompt regex cannot be empty." };
  }

  if (!trimmed.endsWith("$")) {
    return {
      ok: false,
      error: "Prompt regex must be end-anchored with $."
    };
  }

  try {
    const regex = new RegExp(pattern);
    if (regex.flags.includes("m")) {
      return {
        ok: false,
        error: "Prompt regex must not use multiline mode."
      };
    }
    return { ok: true, regex };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid regex pattern."
    };
  }
}

function cloneRegexWithoutState(regex: RegExp): RegExp {
  const flags = regex.flags.replace(/g|y/g, "");
  return new RegExp(regex.source, flags);
}

function matchesTailEnd(regex: RegExp, text: string): boolean {
  const normalized = cloneRegexWithoutState(regex);
  const match = normalized.exec(text);
  if (!match) {
    return false;
  }
  const start = match.index;
  const full = match[0] ?? "";
  return start + full.length === text.length;
}

export class PromptReadyTracker {
  private readonly promptRegex: RegExp;
  private readonly debounceMs: number;
  private readonly tailMaxChars: number;
  private readonly onReady: () => void;

  private tail = "";
  private armed = false;
  private fired = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PromptReadyOptions) {
    this.promptRegex = options.promptRegex;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.tailMaxChars = options.tailMaxChars ?? DEFAULT_TAIL_MAX_CHARS;
    this.onReady = options.onReady;
  }

  onUserInput(data: string): void {
    this.cancelPending();
    this.fired = false;
    this.armed = /[\r\n]/.test(data);
  }

  onTerminalOutput(data: string): void {
    this.tail = appendTail(this.tail, stripAnsi(data), this.tailMaxChars);
    const isMatchingTailEnd = matchesTailEnd(this.promptRegex, this.tail);

    if (this.timer && !isMatchingTailEnd) {
      this.cancelPending();
      return;
    }

    if (!this.armed || this.fired || this.timer || !isMatchingTailEnd) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      const stillMatching = matchesTailEnd(this.promptRegex, this.tail);
      if (!this.armed || this.fired || !stillMatching) {
        return;
      }
      this.fired = true;
      this.onReady();
    }, this.debounceMs);
  }

  dispose(): void {
    this.cancelPending();
  }

  private cancelPending(): void {
    if (!this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }
}
