import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import type { ClaimRow, ClaimStatus } from "./lib/api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function claim(
  id: string,
  customer: string,
  status: ClaimStatus,
  payout: number | null,
): ClaimRow {
  return {
    claim_id: id,
    claim_type: "trip_delay",
    summary: "Flight home canceled by the airline",
    customer_name: customer,
    amount_claimed: id === "CLM-1002" ? 1500 : 420,
    status,
    decision: status === "decided" ? "approve" : null,
    payout,
    submitted_on: "2026-06-24",
  };
}

function stubFetch(claims: ClaimRow[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input === "/api/health") return new Response("{}");
      return new Response(JSON.stringify(claims));
    }),
  );
}

it("shows the queue with each claim's standing", async () => {
  stubFetch([
    claim("CLM-1001", "Maya Patel", "waiting", null),
    claim("CLM-1002", "Liam Nguyen", "decided", 500),
  ]);
  render(<App />);
  expect(await screen.findByText("Maya Patel")).toBeDefined();
  expect(screen.getByText("Waiting")).toBeDefined();
  expect(screen.getByText("Decided")).toBeDefined();
  expect(screen.getByText("$420.00")).toBeDefined();
  expect(screen.getByText("$1,500.00")).toBeDefined();
  expect(screen.getByText("$500.00")).toBeDefined();
  expect(screen.getByRole("button", { name: "Run agent" })).toBeDefined();
  expect(screen.getByText("Backend: up")).toBeDefined();
});

it("shows the backend is down when it cannot be reached", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input === "/api/health") throw new Error("offline");
      return new Response("[]");
    }),
  );
  render(<App />);
  expect(await screen.findByText("Backend: down")).toBeDefined();
});

it("opens a claim from the queue", async () => {
  stubFetch([claim("CLM-1001", "Maya Patel", "waiting", null)]);
  render(<App />);
  expect(await screen.findByText("CLM-1001")).toBeDefined();
  window.location.hash = "#/claims/CLM-1001";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(
    await screen.findByRole("heading", { name: "Claim CLM-1001" }),
  ).toBeDefined();
});

it("shows the agent instructions page", async () => {
  stubFetch([]);
  render(<App />);
  window.location.hash = "#/agent";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(
    await screen.findByRole("heading", { name: "Agent instructions" }),
  ).toBeDefined();
});
