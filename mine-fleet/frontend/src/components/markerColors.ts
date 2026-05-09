import type { TruckState, VehicleState } from "../types";

const STATE_COLORS: Record<TruckState, string> = {
  Loading: "#2563eb",
  Hauling: "#ca8a04",
  Crushing: "#ea580c",
  Returning: "#16a34a",
  Idle: "#6b7280",
};

export function markerColorForVehicle(v: VehicleState): string {
  if (v.health_alerts.length > 0) return "#dc2626";
  return STATE_COLORS[v.state];
}
