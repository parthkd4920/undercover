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
    decision: status === "approved" ? "approve" : null,
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
            claim("CLM-1002", "Liam Nguyen", "approved", 500),
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
  expect(screen.getByText("Approved")).toBeDefined();
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
  await screen.findByText("Maya Patel");
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
  await screen.findByText("Maya Patel");
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

it("runs only the selected waiting claim from the top control", async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const records = [
    claim("CLM-1001", "Maya Patel", "waiting", null),
    claim("CLM-1002", "Liam Nguyen", "waiting", null),
    claim("CLM-1003", "Sam", "declined", 0),
  ];
  const fetchMock = vi.fn((input: string, init?: RequestInit) =>
    init?.method === "POST" ? pending : new Response(JSON.stringify(records)),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<QueuePage />);
  await screen.findByText("Maya Patel");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Waiting claim"), {
    target: { value: "CLM-1002" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }));
  expect(fetchMock).toHaveBeenCalledWith("/api/claims/CLM-1002/run", {
    method: "POST",
  });
  expect(
    screen.getByRole("button", { name: "Running" }).hasAttribute("disabled"),
  ).toBe(true);
  finish(new Response(JSON.stringify({ reply: "Done" })));
  await pending;
  await vi.waitFor(() => {
    expect(screen.getByRole("button", { name: "Run agent" })).toBeDefined();
  });
});

it("disables the top run button when no claims are waiting", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Response(
          JSON.stringify([claim("CLM-1001", "Maya Patel", "approved", 420)]),
        ),
    ),
  );
  render(<QueuePage />);
  await screen.findByText("Maya Patel");
  expect(
    screen.getByRole("button", { name: "Run agent" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByRole("option")).toBeNull();
});
