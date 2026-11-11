import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ClaimRow, ClaimStatus } from "../lib/api";
import { QueuePage } from "./QueuePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function claim(
  id: string,
  customer: string,
  status: ClaimStatus,
  payout: number | null,
): ClaimRow {
  return {
    claim_id: id,
    claim_type: id === "CLM-1002" ? "baggage" : "trip_delay",
    summary: "Flight home canceled by the airline",
    customer_name: customer,
    amount_claimed: 420,
    status,
    decision: status === "decided" ? "approve" : null,
    payout,
    submitted_on: "2026-06-24",
  };
}

it("lists the claims with where each stands", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Response(
          JSON.stringify([
            claim("CLM-1001", "Maya Patel", "waiting", null),
            claim("CLM-1002", "Liam Nguyen", "decided", 500),
          ]),
        ),
    ),
  );
  render(<QueuePage />);
  expect(await screen.findByText("Maya Patel")).toBeDefined();
  expect(screen.getByText("Trip Delay")).toBeDefined();
  expect(screen.getByText("CLM-1001")).toBeDefined();
  expect(screen.getByText("CLM-1002")).toBeDefined();
  expect(screen.getByText("Waiting")).toBeDefined();
  expect(screen.getByText("Decided")).toBeDefined();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

it("runs the agent on a waiting claim and refreshes the queue", async () => {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return new Response(JSON.stringify({ reply: "Done" }));
    return new Response(
      JSON.stringify([claim("CLM-1001", "Maya Patel", "waiting", null)]),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<QueuePage />);
  await screen.findByRole("button", { name: "Run agent" });
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }));
  await vi.waitFor(() => {
    const ran = fetchMock.mock.calls.some(
      ([url, init]) =>
        url === "/api/claims/CLM-1001/run" && init?.method === "POST",
    );
    expect(ran).toBe(true);
  });
});

it("shows the error when the agent cannot run", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            detail: "Claim CLM-1001 is not waiting in the queue",
          }),
          { status: 409 },
        );
      }
      return new Response(
        JSON.stringify([claim("CLM-1001", "Maya Patel", "waiting", null)]),
      );
    }),
  );
  render(<QueuePage />);
  await screen.findByRole("button", { name: "Run agent" });
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("not waiting");
});

it("shows an error when the queue cannot be loaded", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("offline");
    }),
  );
  render(<QueuePage />);
  expect(await screen.findByRole("alert")).toBeDefined();
});
