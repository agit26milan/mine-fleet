import { useEffect } from "react";

import { getBackendOrigin } from "../lib/backendUrl";
import type { FleetSnapshot } from "../types";
import { useFleetStore } from "../store/fleetStore";

export function useInitialFleet(): void {
  const setSnapshot = useFleetStore((s) => s.setSnapshot);

  useEffect(() => {
    const origin = getBackendOrigin();
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${origin}/fleet`);
        if (!res.ok || cancelled) return;
        const snap = (await res.json()) as FleetSnapshot;
        if (!cancelled) setSnapshot(snap);
      } catch {
        /* backend may be down on first paint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSnapshot]);
}
