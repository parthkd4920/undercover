import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InstructionsPage } from "./InstructionsPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders the instructions read only", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input === "/api/agent-instructions") {
        return new Response(
          JSON.stringify({
            instructions:
              "# The UnderCover Agent\n\nYou are the **agent**.\n\n- Read the claim\n- Decide it\n\n1. First\n2. Second\n",
          }),
        );
      }
      throw new Error(`unexpected fetch: ${input}`);
    }),
  );
  render(<InstructionsPage />);
  expect(
    await screen.findByRole("heading", { name: "The UnderCover Agent" }),
  ).toBeDefined();
  expect(screen.getByText("agent")).toBeDefined();
  expect(screen.getByText("Read the claim")).toBeDefined();
  expect(screen.getByText("First")).toBeDefined();
  expect(screen.getByText("Second")).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows the error when the instructions cannot be loaded", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("offline");
    }),
  );
  render(<InstructionsPage />);
  expect(await screen.findByRole("alert")).toBeDefined();
});
