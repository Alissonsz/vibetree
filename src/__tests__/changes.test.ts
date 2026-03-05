import { describe, expect, it, vi } from "vitest";
import { createChangesClient, type ChangesInvoker } from "../hooks/useChanges";

describe("createChangesClient", () => {
  it("invokes get_changed_files with expected payload", async () => {
    const invokeMock = vi.fn(
      async <T,>(
        command: string,
        args?: Record<string, unknown>
      ): Promise<T> => {
        expect(command).toBe("get_changed_files");
        expect(args).toEqual({ worktreePath: "/tmp/repo" });
        return [] as unknown as T;
      }
    );

    const changes = createChangesClient(invokeMock as unknown as ChangesInvoker);
    const result = await changes.getChangedFiles("/tmp/repo");

    expect(result).toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
