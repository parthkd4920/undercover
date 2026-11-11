import { describe, expect, it } from "vitest";
import { claimType, money, statusLabel } from "./format";

describe("money", () => {
  it("formats dollars with cents", () => {
    expect(money(1250)).toBe("$1,250.00");
    expect(money(42.5)).toBe("$42.50");
    expect(money(0)).toBe("$0.00");
  });
});

describe("statusLabel", () => {
  it("labels each standing in plain words", () => {
    expect(statusLabel("waiting")).toBe("Waiting");
    expect(statusLabel("in_progress")).toBe("In progress");
    expect(statusLabel("waiting_for_sign_off")).toBe("Waiting for sign-off");
    expect(statusLabel("approved")).toBe("Approved");
    expect(statusLabel("declined")).toBe("Declined");
    expect(statusLabel("waiting_for_human_review")).toBe(
      "Waiting for human review",
    );
  });
});

describe("claimType", () => {
  it("labels a claim type in words", () => {
    expect(claimType("trip_delay")).toBe("Trip Delay");
    expect(claimType("baggage")).toBe("Baggage");
    expect(claimType("trip_cancellation")).toBe("Trip Cancellation");
  });
});
