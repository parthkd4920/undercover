import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ClaimStatus } from "../lib/api";
import { StatusChip } from "./StatusChip";

afterEach(cleanup);

it.each<[ClaimStatus, string]>([
  ["waiting", "Waiting"],
  ["in_progress", "In progress"],
  ["waiting_for_sign_off", "Waiting for sign-off"],
  ["waiting_for_human_review", "Waiting for human review"],
  ["approved", "Approved"],
  ["declined", "Declined"],
])("labels %s explicitly", (status, label) => {
  render(<StatusChip status={status} />);
  expect(screen.getByText(label).className).toContain(`chip-${status}`);
  expect(screen.queryByText("Decided")).toBeNull();
});
