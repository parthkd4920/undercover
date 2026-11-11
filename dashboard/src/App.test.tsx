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
    decision: status === "approved" ? "approve" : null,
    payout,
    submitted_on: "2026-06-24",
  };
}

function stubFetch(claims: ClaimRow[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      if (input === "/api/health") return new Response("{}");
      if (input === "/api/claims") return new Response(JSON.stringify(claims));
      if (input === "/api/claims/CLM-1001/steps") return new Response("[]");
      if (input === "/api/claims/CLM-1001") {
        return new Response(
          JSON.stringify({
            claim_id: "CLM-1001",
            policy_id: "POL-2001",
            customer_id: "CUS-3001",
            claim_type: "trip_delay",
            submitted_on: "2026-06-24",
            incident_date: "2026-06-18T00:00:00Z",
            incident_location: "Rome, Italy",
            summary: "Flight home canceled by the airline",
            story: "My flight home from Rome was canceled.",
            items: [],
            amount_claimed: 420,
            documents: [],
            status: "waiting",
            decision: null,
            payout: null,
            reason: null,
            reference: null,
            referral_reason: null,
            referral_reference: null,
            referred_on: null,
            reviewed_by: null,
            reviewed_on: null,
            decided_on: null,
            run_started_on: null,
            run_attempts: 0,
            signed_off_by: null,
            signed_off_on: null,
            paid_amount: null,
            paid_on: null,
          }),
        );
      }
      if (input === "/api/customers/CUS-3001") {
        return new Response(
          JSON.stringify({
            customer_id: "CUS-3001",
            name: "Maya Patel",
            email: "maya.patel@example.com",
            phone: "+1 201 555 0143",
            date_of_birth: "1988-03-14",
            address: {
              street: "48 Wayne Street",
              city: "Jersey City",
              state: "NJ",
              zip: "07302",
            },
            customer_since: "2023-04-11",
            previous_claims: [],
          }),
        );
      }
      if (input === "/api/policies/POL-2001") {
        return new Response(
          JSON.stringify({
            policy_id: "POL-2001",
            customer_id: "CUS-3001",
            plan: "premium",
            add_ons: [],
            purchased_on: "2026-04-22",
            sold_through: "Meridian Air checkout",
            status: "active",
            trip: {
              destination: "Rome, Italy",
              departs_on: "2026-06-10",
              returns_on: "2026-06-18",
              trip_cost: 3100,
            },
            travelers: ["Maya Patel"],
          }),
        );
      }
      if (input === "/api/handlers") return new Response("[]");
      if (input === "/api/agent-instructions") {
        return new Response(
          JSON.stringify({ instructions: "# The agent\n\nWords" }),
        );
      }
      throw new Error(`unexpected fetch: ${input}`);
    }),
  );
}

it("shows the queue with each claim's standing", async () => {
  stubFetch([
    claim("CLM-1001", "Maya Patel", "waiting", null),
    claim("CLM-1002", "Liam Nguyen", "approved", 500),
  ]);
  render(<App />);
  expect(await screen.findByText("Maya Patel")).toBeDefined();
  expect(screen.getByText("Waiting")).toBeDefined();
  expect(screen.getByText("Approved")).toBeDefined();
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
    await screen.findByRole("heading", { name: "CLM-1001" }),
  ).toBeDefined();
  expect(
    await screen.findByText("My flight home from Rome was canceled."),
  ).toBeDefined();
});

it("shows the agent instructions page", async () => {
  stubFetch([]);
  render(<App />);
  window.location.hash = "#/agent";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(
    await screen.findByRole("heading", { name: "The agent" }),
  ).toBeDefined();
  expect(screen.getByText("Words")).toBeDefined();
});
