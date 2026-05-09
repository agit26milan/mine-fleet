use std::collections::HashMap;

use chrono::{DateTime, Utc};

use crate::health;
use crate::types::{FleetSnapshot, Telemetry, TruckState, VehicleState};

#[derive(Debug, thiserror::Error)]
pub enum UpdateVehicleError {
    #[error("invalid telemetry timestamp")]
    InvalidTimestamp,
}

struct TrackedVehicle {
    vehicle: VehicleState,
    idle_entered_at: Option<DateTime<Utc>>,
    rpm_high_since: Option<DateTime<Utc>>,
}

pub struct FleetState {
    inner: HashMap<String, TrackedVehicle>,
}

impl FleetState {
    pub fn new() -> Self {
        Self {
            inner: HashMap::new(),
        }
    }

    /// Updates fleet state from a telemetry sample. `telemetry.timestamp` must be valid RFC3339 UTC.
    pub fn update_vehicle(&mut self, telemetry: Telemetry) -> Result<VehicleState, UpdateVehicleError> {
        let truck_id = telemetry.truck_id.clone();
        let now_utc = parse_utc(&telemetry.timestamp).ok_or(UpdateVehicleError::InvalidTimestamp)?;

        let prev = self.inner.remove(&truck_id);

        let state = prev
            .as_ref()
            .map(|p| p.vehicle.state)
            .unwrap_or(TruckState::Idle);

        let idle_entered_at = match state {
            TruckState::Idle => match &prev {
                None => Some(now_utc),
                Some(p) if p.vehicle.state != TruckState::Idle => Some(now_utc),
                Some(p) => p.idle_entered_at,
            },
            _ => None,
        };

        let rpm_high_since = if telemetry.rpm > 2800 {
            match &prev {
                None => Some(now_utc),
                Some(p) if p.vehicle.telemetry.rpm <= 2800 => Some(now_utc),
                Some(p) => p.rpm_high_since,
            }
        } else {
            None
        };

        let prev_telemetry = prev.as_ref().map(|p| &p.vehicle.telemetry);

        let health_alerts = health::classify(
            &telemetry,
            prev_telemetry,
            state,
            idle_entered_at,
            rpm_high_since,
        );

        let vehicle = VehicleState {
            truck_id: truck_id.clone(),
            state,
            telemetry,
            health_alerts,
        };

        self.inner.insert(
            truck_id,
            TrackedVehicle {
                vehicle: vehicle.clone(),
                idle_entered_at,
                rpm_high_since,
            },
        );

        Ok(vehicle)
    }

    pub fn get_snapshot(&self) -> FleetSnapshot {
        let mut vehicles: Vec<VehicleState> =
            self.inner.values().map(|t| t.vehicle.clone()).collect();
        vehicles.sort_by(|a, b| a.truck_id.cmp(&b.truck_id));
        FleetSnapshot { vehicles }
    }
}

fn parse_utc(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::LoadStatus;

    fn sample(ts: &str, truck: &str, fuel: f32) -> Telemetry {
        Telemetry {
            truck_id: truck.into(),
            timestamp: ts.into(),
            lat: 0.0,
            lon: 0.0,
            speed_kmh: 10.0,
            rpm: 1000,
            load_status: LoadStatus::Empty,
            fuel_pct: fuel,
        }
    }

    #[tokio::test]
    async fn concurrent_updates_remain_consistent() {
        let fleet = std::sync::Arc::new(tokio::sync::RwLock::new(FleetState::new()));
        let mut handles = vec![];
        for i in 0..10u32 {
            let f = fleet.clone();
            handles.push(tokio::spawn(async move {
                let tel = sample(
                    &format!("2026-05-09T00:00:{i:02}Z"),
                    "truck-a",
                    90.0 - i as f32,
                );
                let mut g = f.write().await;
                g.update_vehicle(tel).unwrap();
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        let snap = fleet.read().await.get_snapshot();
        assert_eq!(snap.vehicles.len(), 1);
        assert_eq!(snap.vehicles[0].truck_id, "truck-a");
    }
}
