import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BackendStatus } from "./BackendStatus";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the backend is up", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Response("{}")),
  );
  render(<BackendStatus />);
  expect(await screen.findByText("Backend: up")).toBeDefined();
});

it("shows the backend is down", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("offline");
    }),
  );
  render(<BackendStatus />);
  expect(await screen.findByText("Backend: down")).toBeDefined();
});
