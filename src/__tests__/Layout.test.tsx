import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Layout from "../components/Layout";

describe("Layout", () => {
  it("renders all three panes", () => {
    render(<Layout />);

    expect(screen.getByTestId("repo-pane")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-pane")).toBeInTheDocument();
    expect(screen.getByTestId("changes-pane")).toBeInTheDocument();
  });
});
