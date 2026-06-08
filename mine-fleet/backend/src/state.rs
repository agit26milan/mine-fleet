use std::collections::{HashMap, VecDeque};

use chrono::{DateTime, Utc};

use crate::health;
use crate::types::{FleetSnapshot, Telemetry, TruckState, VehicleState};
use crate::util;

const TELEMETRY_HISTORY_CAP: usize = 300;

#[derive(Debug, thiserror::Error)]
pub enum UpdateVehicleError {
    #[error("invalid telemetry timestamp")]
    InvalidTimestamp,
}

struct TrackedVehicle {
    vehicle: VehicleState,
    idle_entered_at: Option<DateTime<Utc>>,
    rpm_high_since: Option<DateTime<Utc>>,
    /// Oldest → newest (max [`TELEMETRY_HISTORY_CAP`] samples).
    telemetry_history: VecDeque<Telemetry>,
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
        let now_utc = util::parse_utc(&telemetry.timestamp).ok_or(UpdateVehicleError::InvalidTimestamp)?;

        let prev = self.inner.remove(&truck_id);

        let state = determine_state(
            prev.as_ref().map(|p| p.vehicle.state),
            &telemetry,
        );

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

        let mut telemetry_history = prev
            .as_ref()
            .map(|p| p.telemetry_history.clone())
            .unwrap_or_default();
        telemetry_history.push_back(telemetry.clone());
        while telemetry_history.len() > TELEMETRY_HISTORY_CAP {
            telemetry_history.pop_front();
        }

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
                telemetry_history,
            },
        );

        Ok(vehicle)
    }

    /// Chronological telemetry (oldest first), up to [`TELEMETRY_HISTORY_CAP`] entries.
    pub fn get_telemetry_history(&self, truck_id: &str) -> Vec<Telemetry> {
        self.inner
            .get(truck_id)
            .map(|t| t.telemetry_history.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn get_snapshot(&self) -> FleetSnapshot {
        let mut vehicles: Vec<VehicleState> =
            self.inner.values().map(|t| t.vehicle.clone()).collect();
        vehicles.sort_by(|a, b| a.truck_id.cmp(&b.truck_id));
        FleetSnapshot { vehicles }
    }
}

fn determine_state(prev_state: Option<TruckState>, telemetry: &Telemetry) -> TruckState {
    let prev = prev_state.unwrap_or(TruckState::Idle);

    if telemetry.speed_kmh > 5.0 {
        match telemetry.load_status {
            crate::types::LoadStatus::Loaded => TruckState::Hauling,
            crate::types::LoadStatus::Empty => TruckState::Returning,
        }
    } else if telemetry.load_status == crate::types::LoadStatus::Loaded {
        match prev {
            TruckState::Hauling | TruckState::Crushing => TruckState::Crushing,
            _ => TruckState::Loading,
        }
    } else if telemetry.speed_kmh == 0.0 && telemetry.rpm < 1000 {
        TruckState::Idle
    } else {
        match prev {
            TruckState::Returning | TruckState::Idle => TruckState::Loading,
            _ => prev,
        }
    }
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
