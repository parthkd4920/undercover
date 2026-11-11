import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  Claim,
  ClaimStatus,
  Customer,
  Handler,
  Policy,
  Step,
} from "../lib/api";
import { ClaimPage } from "./ClaimPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const handlers: Handler[] = [
  {
    handler_id: "HND-01",
    name: "Dana Whitfield",
    role: "Senior Claims Handler",
    email: "dana.whitfield@undercover.example",
    can_approve_over_limit: true,
  },
  {
    handler_id: "HND-02",
    name: "Marcus Oyelaran",
    role: "Claims Handler",
    email: "marcus.oyelaran@undercover.example",
    can_approve_over_limit: true,
  },
];

const customer: Customer = {
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
  previous_claims: [
    {
      claim_id: "CLM-0412",
      filed_on: "2024-08-19",
      incident_date: "2024-08-09",
      claim_type: "baggage_delay",
      summary: "Checked bag arrived 30 hours late in Lisbon",
      outcome: "approved",
      amount_paid: 140,
    },
  ],
};

const policy: Policy = {
  policy_id: "POL-2001",
  customer_id: "CUS-3001",
  plan: "premium",
  add_ons: ["electronics_plus"],
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
};

function claim(status: ClaimStatus): Claim {
  const decided = status === "decided" || status === "waiting_for_sign_off";
  return {
    claim_id: "CLM-1001",
    policy_id: "POL-2001",
    customer_id: "CUS-3001",
    claim_type: "trip_delay",
    submitted_on: "2026-06-24",
    incident_date: "2026-06-18T00:00:00Z",
    incident_location: "Rome, Italy",
    summary: "Flight home canceled by the airline",
    story: "My flight home from Rome was canceled.",
    items: [
      {
        description: "Airport hotel, one night",
        category: "accommodation",
        amount: 245,
      },
    ],
    amount_claimed: 420,
    documents: [
      {
        name: "Hotel receipt",
        type: "receipt",
        content: "Hotel Aurelia, $245.00.",
      },
    ],
    status,
    decision: decided ? "approve" : null,
    payout: decided ? 420 : null,
    reason: decided
      ? "The airline's cancellation and the receipts support the claim."
      : null,
    reference: decided ? "Section 3 (Trip Delay); section 10" : null,
    decided_on: decided ? "2026-06-25T09:00:00Z" : null,
    signed_off_by: null,
    signed_off_on: null,
    paid_amount: status === "decided" ? 420 : null,
    paid_on: status === "decided" ? "2026-06-25T09:01:00Z" : null,
  };
}

interface StubOptions {
  failPath?: string;
  steps?: () => Step[];
  signOff?: () => Promise<Response>;
  claimResponse?: (id: string) => Response | Promise<Response>;
}

/** Return the current activity fixture. */
function stubSteps(options: StubOptions): Step[] {
  return (
    options.steps?.() ?? [
      { step: "Read claim CLM-1001", at: "2026-06-25T09:00:00Z" },
    ]
  );
}

/** Stub the API while allowing delayed responses and individual failures. */
function stubBackend(
  claimsByStatus: Record<string, Claim>,
  options: StubOptions = {},
) {
  let signedOff = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      if (input === options.failPath)
        return new Response(JSON.stringify({ detail: "Unavailable" }), {
          status: 503,
        });
      const id = /^\/api\/claims\/([^/]+)$/.exec(input)?.[1];
      if (id !== undefined) {
        if (options.claimResponse !== undefined)
          return options.claimResponse(id);
        const loaded = claimsByStatus[id];
        if (signedOff) return new Response(JSON.stringify(claim("decided")));
        return new Response(JSON.stringify(loaded));
      }
      if (input === "/api/claims/CLM-1001/steps") {
        return new Response(JSON.stringify(stubSteps(options)));
      }
      if (
        input === "/api/claims/CLM-1001/sign-off" &&
        init?.method === "POST"
      ) {
        if (options.signOff !== undefined) return options.signOff();
        signedOff = true;
        return new Response("{}");
      }
      if (input === "/api/customers/CUS-3001")
        return new Response(JSON.stringify(customer));
      if (input === "/api/policies/POL-2001")
        return new Response(JSON.stringify(policy));
      if (input === "/api/handlers")
        return new Response(
          JSON.stringify([
            ...handlers,
            {
              ...handlers[0],
              handler_id: "HND-03",
              name: "Unauthorized handler",
              can_approve_over_limit: false,
            },
          ]),
        );
      throw new Error(`unexpected fetch: ${input}`);
    }),
  );
}

it("shows a decided claim with its decision, payment and the agent's work", async () => {
  stubBackend({ "CLM-1001": claim("decided") });
  render(<ClaimPage claimId="CLM-1001" />);
  expect(await screen.findByText("maya.patel@example.com")).toBeDefined();
  expect(screen.getByText("Decided")).toBeDefined();
  expect(screen.getByText("Airport hotel, one night")).toBeDefined();
  expect(screen.getByText(/Hotel receipt/)).toBeDefined();
  expect(screen.getByText("Read claim CLM-1001")).toBeDefined();
  expect(screen.getByText("Approve")).toBeDefined();
  expect(screen.getByText(/Section 3 \(Trip Delay\)/)).toBeDefined();
  expect(screen.getByText(/Paid \$420\.00 on/)).toBeDefined();
  expect(screen.getByText(/The airline's cancellation/)).toBeDefined();
});

it("shows a claim waiting for sign-off and signs it off", async () => {
  stubBackend({ "CLM-1001": claim("waiting_for_sign_off") });
  render(<ClaimPage claimId="CLM-1001" />);
  expect(await screen.findByText("Waiting for sign-off")).toBeDefined();
  expect(
    screen.getByText(/Waiting for a handler's sign-off to pay/),
  ).toBeDefined();
  fireEvent.change(screen.getByLabelText("Handler"), {
    target: { value: "HND-02" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign off" }));
  expect(await screen.findByText("Decided")).toBeDefined();
  expect(screen.getByText(/Paid \$420\.00 on/)).toBeDefined();
});

it("shows a claim in progress without a decision", async () => {
  stubBackend({ "CLM-1001": claim("in_progress") });
  render(<ClaimPage claimId="CLM-1001" />);
  expect(await screen.findByText("In progress")).toBeDefined();
  expect(screen.getByText("Not decided yet")).toBeDefined();
});

it("shows the error when the claim cannot be loaded", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("offline");
    }),
  );
  render(<ClaimPage claimId="CLM-1001" />);
  expect(await screen.findByRole("alert")).toBeDefined();
});

it.each(["decline", "refer"])(
  "does not show payment or sign-off for %s",
  async (decision) => {
    stubBackend({
      "CLM-1001": {
        ...claim("decided"),
        decision,
        payout: 0,
        paid_amount: null,
        paid_on: null,
      },
    });
    render(<ClaimPage claimId="CLM-1001" />);
    await screen.findByText("maya.patel@example.com");
    expect(screen.queryByText(/sign-off to pay/)).toBeNull();
    expect(screen.queryByText("Payment pending")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign off" })).toBeNull();
  },
);

it("labels an unpaid approval within the limit accurately", async () => {
  stubBackend({
    "CLM-1001": { ...claim("decided"), paid_amount: null, paid_on: null },
  });
  render(<ClaimPage claimId="CLM-1001" />);
  expect(await screen.findByText("Payment pending")).toBeDefined();
  expect(screen.queryByText(/sign-off to pay/)).toBeNull();
});

it.each([
  ["/api/customers/CUS-3001", "Customer"],
  ["/api/policies/POL-2001", "Policy"],
  ["/api/claims/CLM-1001/steps", "Agent steps"],
  ["/api/handlers", "Handlers"],
])("reports a failed supporting request to %s", async (failPath, label) => {
  stubBackend({ "CLM-1001": claim("waiting") }, { failPath });
  render(<ClaimPage claimId="CLM-1001" />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    label + " could not be loaded",
  );
  expect(
    screen.queryByText(/Loading the customer|Loading the policy/),
  ).toBeNull();
});

it("disables submission while signing and shows the backend error", async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  stubBackend(
    { "CLM-1001": claim("waiting_for_sign_off") },
    { signOff: () => pending },
  );
  render(<ClaimPage claimId="CLM-1001" />);
  await screen.findByText("maya.patel@example.com");
  expect(
    screen.queryByRole("option", { name: "Unauthorized handler" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign off" }));
  expect(
    screen
      .getByRole("button", { name: "Signing off" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => {
    finish(
      new Response(JSON.stringify({ detail: "Sign-off failed" }), {
        status: 409,
      }),
    );
    await pending;
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Sign-off failed",
  );
  expect(screen.getByText("Waiting for sign-off")).toBeDefined();
});

it("ignores a delayed response after navigating to another claim", async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  stubBackend(
    {},
    {
      claimResponse: (id) =>
        id === "CLM-1001"
          ? pending
          : new Response(JSON.stringify({ ...claim("waiting"), claim_id: id })),
    },
  );
  const view = render(<ClaimPage claimId="CLM-1001" />);
  view.rerender(<ClaimPage claimId="CLM-1002" />);
  await screen.findByRole("heading", { name: "CLM-1002" });
  await act(async () => {
    finish(new Response(JSON.stringify(claim("decided"))));
    await pending;
  });
  expect(screen.queryByRole("heading", { name: "CLM-1001" })).toBeNull();
  expect(screen.getByRole("heading", { name: "CLM-1002" })).toBeDefined();
});

it("polls an active claim and stops when the decision arrives", async () => {
  vi.useFakeTimers();
  const records = { "CLM-1001": claim("in_progress") };
  let step = 0;
  stubBackend(records, {
    steps: () => [{ step: `Step ${String(++step)}`, at: "2026-11-11" }],
  });
  const view = render(<ClaimPage claimId="CLM-1001" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText("In progress")).toBeDefined();
  expect(screen.getByText("Step 1")).toBeDefined();
  const fetchMock = vi.mocked(fetch);
  const calls = fetchMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  expect(screen.getByText("Step 2")).toBeDefined();
  records["CLM-1001"] = claim("decided");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(screen.getByText("Decided")).toBeDefined();
  const finishedCalls = fetchMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(fetchMock.mock.calls).toHaveLength(finishedCalls);
  view.unmount();
});

it("cancels polling on unmount", async () => {
  vi.useFakeTimers();
  stubBackend({ "CLM-1001": claim("in_progress") });
  const view = render(<ClaimPage claimId="CLM-1001" />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  view.unmount();
  const calls = vi.mocked(fetch).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
});

it("renders repeated step descriptions as separate entries", async () => {
  const error = vi.spyOn(console, "error");
  stubBackend(
    { "CLM-1001": claim("decided") },
    {
      steps: () => [
        { step: "Read the policy wording", at: "2026-11-11T09:00:00Z" },
        { step: "Read the policy wording", at: "2026-11-11T09:00:00Z" },
      ],
    },
  );
  render(<ClaimPage claimId="CLM-1001" />);
  expect(await screen.findAllByText("Read the policy wording")).toHaveLength(2);
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
