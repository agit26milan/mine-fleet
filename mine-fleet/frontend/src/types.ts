/** High-level operational state of a haul truck. */
export type TruckState =
  | "Loading"
  | "Hauling"
  | "Crushing"
  | "Returning"
  | "Idle";

/** Payload / bed load status from telemetry. */
export type LoadStatus = "Empty" | "Loaded";

/** Active health / safety alerts derived from telemetry and state. */
export type HealthAlert =
  | "OverRev"
  | "UnsafeSpeedLoaded"
  | "ExcessiveIdle"
  | "LowFuel"
  | "FuelAnomaly";

/** Single telemetry sample (wire contract). `timestamp` is UTC ISO8601. */
export interface Telemetry {
  truck_id: string;
  timestamp: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  rpm: number;
  load_status: LoadStatus;
  fuel_pct: number;
}

/** Vehicle view: current telemetry, derived alerts, and operational state. */
export interface VehicleState {
  truck_id: string;
  state: TruckState;
  telemetry: Telemetry;
  health_alerts: HealthAlert[];
}

/** Full fleet snapshot for clients and SSE. */
export interface FleetSnapshot {
  vehicles: VehicleState[];
}

/**
 * SSE payload envelope. Matches Rust `SseEvent` JSON (externally tagged):
 * `{ "TelemetryUpdate": VehicleState }` or `{ "FleetSnapshot": FleetSnapshot }`.
 */
export type SseEvent =
  | { TelemetryUpdate: VehicleState }
  | { FleetSnapshot: FleetSnapshot };
