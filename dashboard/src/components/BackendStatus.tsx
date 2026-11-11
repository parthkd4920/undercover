/** Whether the backend is up, shown in the dashboard's header. */

import { useEffect, useState } from "react";
import { backendUp } from "../lib/api";

function standing(up: boolean | null): string {
  if (up === null) return "checking";
  if (up) return "up";
  return "down";
}

export function BackendStatus() {
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void backendUp().then((isUp) => {
      if (alive) setUp(isUp);
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <p className="backend" aria-live="polite">
      Backend: {standing(up)}
    </p>
  );
}
