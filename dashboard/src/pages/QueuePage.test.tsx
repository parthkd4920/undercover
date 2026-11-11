import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ClaimRow, ClaimStatus } from "../lib/api";
import { QueuePage } from "./QueuePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

it("runs waiting claims one by one and prevents duplicate clicks", async () => {
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
    init?.method === "POST"
      ? pending.then((response) => response.clone())
      : new Response(JSON.stringify(records)),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<QueuePage />);
  await screen.findByText("Maya Patel");
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }));
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith("/api/claims/CLM-1001/run", {
      method: "POST",
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/claims/CLM-1002/run", {
      method: "POST",
    });
  });
  const button = screen.getByRole("button", {
    name: "Running all waiting claims",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  finish(new Response(JSON.stringify({ reply: "Done" })));
  await pending;
  await screen.findByText("Finished 2 of 2 agent runs.");
  expect(fetchMock).toHaveBeenCalledWith("/api/claims/CLM-1002/run", {
    method: "POST",
  });
  expect(screen.queryByRole("combobox")).toBeNull();
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

it("continues other waiting runs when one claim fails and identifies the failed claim", async () => {
  const records = [
    claim("CLM-1001", "Maya Patel", "waiting", null),
    claim("CLM-1002", "Liam Nguyen", "waiting", null),
  ];
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response(JSON.stringify(records));
    if (input.includes("CLM-1001"))
      return new Response(JSON.stringify({ detail: "Model unavailable" }), {
        status: 500,
      });
    return new Response(JSON.stringify({ reply: "Done" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<QueuePage />);
  await screen.findByText("Maya Patel");
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "CLM-1001: Model unavailable",
  );
  expect(screen.getByText("Finished 1 of 2 agent runs.")).toBeDefined();
  expect(fetchMock).toHaveBeenCalledWith("/api/claims/CLM-1002/run", {
    method: "POST",
  });
});

it("uses a fresh waiting snapshot before starting the batch", async () => {
  const records = [claim("CLM-1001", "Maya Patel", "waiting", null)];
  const fetchMock = vi.fn(() => new Response(JSON.stringify(records)));
  vi.stubGlobal("fetch", fetchMock);
  render(<QueuePage />);
  await screen.findByText("Maya Patel");
  records[0].status = "in_progress";
  fireEvent.click(screen.getByRole("button", { name: "Run agent" }));
  await screen.findByText("Finished 0 of 0 agent runs.");
  expect(fetchMock.mock.calls).toHaveLength(3);
});

it("refreshes count cards when the queue changes during polling", async () => {
  vi.useFakeTimers();
  const records = [claim("CLM-1001", "Maya Patel", "waiting", null)];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Response(JSON.stringify(records))),
  );
  render(<QueuePage />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(
    screen.getByText("Waiting claims").nextElementSibling?.textContent,
  ).toBe("1");
  records[0].status = "approved";
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(
    screen.getByText("Waiting claims").nextElementSibling?.textContent,
  ).toBe("0");
  expect(
    screen.getByText("Approved claims").nextElementSibling?.textContent,
  ).toBe("1");
});
