/** The status chip shown for each claim in the queue. */

import type { ClaimStatus } from "../lib/api";
import { statusLabel } from "../lib/format";

interface StatusChipProps {
  readonly status: ClaimStatus;
}

export function StatusChip({ status }: StatusChipProps) {
  return <span className={`chip chip-${status}`}>{statusLabel(status)}</span>;
}
