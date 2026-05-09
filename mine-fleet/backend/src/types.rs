use serde::{Deserialize, Serialize};

/// High-level operational state of a haul truck.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum TruckState {
    Loading,
    Hauling,
    Crushing,
    Returning,
    Idle,
}

/// Payload / bed load status from telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum LoadStatus {
    Empty,
    Loaded,
}

/// Active health / safety alerts derived from telemetry and state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HealthAlert {
    OverRev,
    UnsafeSpeedLoaded,
    ExcessiveIdle,
    LowFuel,
    FuelAnomaly,
}

/// Single telemetry sample (wire contract). `timestamp` is UTC ISO8601.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Telemetry {
    pub truck_id: String,
    pub timestamp: String,
    pub lat: f64,
    pub lon: f64,
    pub speed_kmh: f32,
    pub rpm: u32,
    pub load_status: LoadStatus,
    pub fuel_pct: f32,
}

/// Vehicle view: current telemetry, derived alerts, and operational state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VehicleState {
    pub truck_id: String,
    pub state: TruckState,
    pub telemetry: Telemetry,
    pub health_alerts: Vec<HealthAlert>,
}

/// Full fleet snapshot for clients and SSE.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FleetSnapshot {
    pub vehicles: Vec<VehicleState>,
}

/// SSE payload envelope. Serialized with externally tagged enum shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum SseEvent {
    TelemetryUpdate(VehicleState),
    FleetSnapshot(FleetSnapshot),
}
