import { useMemo } from "react";

import type { TruckState } from "../types";
import { useFleetStore } from "../store/fleetStore";

const STATE_ORDER: TruckState[] = [
  "Loading",
  "Hauling",
  "Crushing",
  "Returning",
  "Idle",
];

export function FleetSummaryPanel() {
  const vehicles = useFleetStore((s) => s.vehicles);
  const lastUpdateAt = useFleetStore((s) => s.lastUpdateAt);

  const { counts, alertCount } = useMemo(() => {
    const counts: Record<TruckState, number> = {
      Loading: 0,
      Hauling: 0,
      Crushing: 0,
      Returning: 0,
      Idle: 0,
    };
    let alertCount = 0;
    for (const v of Object.values(vehicles)) {
      counts[v.state] += 1;
      if (v.health_alerts.length > 0) alertCount += 1;
    }
    return { counts, alertCount };
  }, [vehicles]);

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 1000,
        background: "rgba(255,255,255,0.94)",
        borderRadius: 8,
        padding: "12px 14px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
        fontSize: 13,
        minWidth: 200,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Fleet summary</div>
      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        {STATE_ORDER.map((st) => (
          <li key={st}>
            {st}: {counts[st]}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 8 }}>
        With alerts: <strong>{alertCount}</strong>
      </div>
      <div style={{ marginTop: 6, color: "#4b5563", fontSize: 12 }}>
        Last update: {lastUpdateAt ?? "—"}
      </div>
    </div>
  );
}
