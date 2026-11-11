import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Handler } from "../lib/api";
import { HumanReviewForm } from "./HumanReviewForm";

const handlers: Handler[] = [
  {
    handler_id: "HND-01",
    name: "Dana",
    role: "Senior handler",
    email: "dana@example.com",
    can_approve_over_limit: true,
  },
  {
    handler_id: "HND-03",
    name: "Sam",
    role: "Handler",
    email: "sam@example.com",
    can_approve_over_limit: false,
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Fill the minimum review evidence and an optional approval amount. */
function fill(payout = "420") {
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "Evidence supports the decision." },
  });
  fireEvent.change(screen.getByLabelText("Policy reference"), {
    target: { value: "Section 3" },
  });
  fireEvent.change(screen.getByLabelText("Payout (USD)"), {
    target: { value: payout },
  });
}

it.each(["approve", "decline"] as const)(
  "submits the handler's %s decision with an appropriate payout",
  async (decision) => {
    const fetchMock = vi.fn(() => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = vi.fn();
    render(
      <HumanReviewForm
        claimId="CLM-1001"
        handlers={handlers}
        onResolved={resolved}
      />,
    );
    fill();
    fireEvent.change(screen.getByLabelText("Reviewing handler"), {
      target: { value: "HND-03" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: decision === "approve" ? "Approve" : "Deny",
      }),
    );
    await vi.waitFor(() => {
      expect(resolved).toHaveBeenCalledOnce();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/claims/CLM-1001/human-review",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          handler_id: "HND-03",
          decision,
          payout: decision === "approve" ? 420 : 0,
          reason: "Evidence supports the decision.",
          reference: "Section 3",
        }),
      }),
    );
  },
);

it("validates required evidence and invalid approval amounts without calling the API", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <HumanReviewForm
      claimId="CLM-1001"
      handlers={handlers}
      onResolved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "reason and policy reference",
  );
  fill("-2");
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(screen.getByRole("alert").textContent).toContain("finite payout");
  fill("");
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(fetchMock).not.toHaveBeenCalled();
});

it("explains when another handler must sign off", () => {
  render(
    <HumanReviewForm
      claimId="CLM-1001"
      handlers={handlers}
      onResolved={vi.fn()}
    />,
  );
  fill("2000");
  fireEvent.change(screen.getByLabelText("Reviewing handler"), {
    target: { value: "HND-03" },
  });
  expect(screen.getByText(/will wait for an authorized handler/)).toBeDefined();
});

it("blocks double submission and recovers after a validation error", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetchMock = vi.fn(() => pending);
  vi.stubGlobal("fetch", fetchMock);
  const resolved = vi.fn();
  render(
    <HumanReviewForm
      claimId="CLM-1001"
      handlers={handlers}
      onResolved={resolved}
    />,
  );
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(
    screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => {
    finish(
      new Response(
        JSON.stringify({ detail: [{ msg: "The claim was already reviewed" }] }),
        { status: 422 },
      ),
    );
    await pending;
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "already reviewed",
  );
  expect(resolved).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled"),
  ).toBe(false);
});

it("disables decisions when handlers could not be loaded", () => {
  render(
    <HumanReviewForm claimId="CLM-1001" handlers={[]} onResolved={vi.fn()} />,
  );
  expect(
    screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled"),
  ).toBe(true);
});
