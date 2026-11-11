/** A hook that follows the page's hash route, like #/claims/CLM-1001. */

import { useEffect, useState } from "react";

export function useHashRoute(): string {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => {
      setRoute(window.location.hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
  return route;
}
