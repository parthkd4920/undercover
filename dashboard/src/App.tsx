/** The UnderCover dashboard: the queue, a claim and the agent's instructions. */

import type { ReactNode } from "react";
import { BackendStatus } from "./components/BackendStatus";
import { useHashRoute } from "./hooks/useHashRoute";
import { ClaimPage } from "./pages/ClaimPage";
import { InstructionsPage } from "./pages/InstructionsPage";
import { QueuePage } from "./pages/QueuePage";

export function App() {
  const route = useHashRoute();
  const claimId = /^#\/claims\/(.+)$/.exec(route)?.[1];
  let page: ReactNode;
  if (claimId !== undefined) {
    page = <ClaimPage claimId={claimId} />;
  } else if (route === "#/agent") {
    page = <InstructionsPage />;
  } else {
    page = <QueuePage />;
  }
  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1 className="wordmark">UnderCover</h1>
          <p className="tagline">Travel insurance, handled with care</p>
        </div>
        <nav>
          <a className={route === "#/" ? "active" : ""} href="#/">
            Claims
          </a>
          <a className={route === "#/agent" ? "active" : ""} href="#/agent">
            Agent instructions
          </a>
          <BackendStatus />
        </nav>
      </header>
      <main>{page}</main>
    </div>
  );
}
