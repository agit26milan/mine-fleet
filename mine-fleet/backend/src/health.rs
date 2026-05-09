use chrono::{DateTime, Utc};

use crate::types::{HealthAlert, LoadStatus, Telemetry, TruckState};

/// Pure health classification: no I/O, no mutation, no wall-clock reads.
///
/// `idle_since`: UTC instant when the truck entered [`TruckState::Idle`], if currently idle.
///
/// `rpm_high_since`: UTC instant when RPM first exceeded 2800 in the current high-RPM streak.
pub fn classify(
    telemetry: &Telemetry,
    prev: Option<&Telemetry>,
    current_state: TruckState,
    idle_since: Option<DateTime<Utc>>,
    rpm_high_since: Option<DateTime<Utc>>,
) -> Vec<HealthAlert> {
    let mut alerts = Vec::new();

    if telemetry.speed_kmh > 30.0 && telemetry.load_status == LoadStatus::Loaded {
        alerts.push(HealthAlert::UnsafeSpeedLoaded);
    }

    if telemetry.fuel_pct < 15.0 {
        alerts.push(HealthAlert::LowFuel);
    }

    let Some(now) = parse_utc(&telemetry.timestamp) else {
        return alerts;
    };

    if current_state == TruckState::Idle {
        if let Some(since) = idle_since {
            if (now - since).num_milliseconds() > 300_000 {
                alerts.push(HealthAlert::ExcessiveIdle);
            }
        }
    }

    if telemetry.rpm > 2800 {
        if let Some(since) = rpm_high_since {
            if (now - since).num_milliseconds() > 5_000 {
                alerts.push(HealthAlert::OverRev);
            }
        }
    }

    if let Some(p) = prev {
        let Some(t_prev) = parse_utc(&p.timestamp) else {
            return alerts;
        };
        let dt_ms = (now - t_prev).num_milliseconds();
        if dt_ms < 30_000 && p.fuel_pct - telemetry.fuel_pct > 10.0 {
            alerts.push(HealthAlert::FuelAnomaly);
        }
    }

    alerts
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

    fn tel(ts: &str, rpm: u32, fuel: f32) -> Telemetry {
        Telemetry {
            truck_id: "t1".into(),
            timestamp: ts.into(),
            lat: 0.0,
            lon: 0.0,
            speed_kmh: 0.0,
            rpm,
            load_status: LoadStatus::Empty,
            fuel_pct: fuel,
        }
    }

    #[test]
    fn over_rev_requires_more_than_five_seconds_above_threshold() {
        let t0 = tel("2026-05-09T00:00:00Z", 3000, 50.0);
        let t5 = tel("2026-05-09T00:00:05.001Z", 3000, 50.0);
        let start = parse_utc(&t0.timestamp).unwrap();
        let alerts = classify(
            &t5,
            Some(&t0),
            TruckState::Hauling,
            None,
            Some(start),
        );
        assert!(alerts.contains(&HealthAlert::OverRev));
    }

    #[test]
    fn over_rev_not_raised_on_single_spike() {
        let t = tel("2026-05-09T00:00:00Z", 3100, 50.0);
        let alerts = classify(&t, None, TruckState::Hauling, None, None);
        assert!(!alerts.contains(&HealthAlert::OverRev));
    }

    /// Six samples ~1s apart, RPM sustained above threshold; OverRev once elapsed over 5s.
    #[test]
    fn over_rev_after_six_telemetry_samples_one_second_apart() {
        let start = parse_utc("2026-05-09T12:00:00Z").unwrap();
        let mut prev: Option<Telemetry> = None;
        for i in 0..5 {
            let t = tel(&format!("2026-05-09T12:00:0{i}Z"), 3000, 50.0);
            let _ = classify(&t, prev.as_ref(), TruckState::Hauling, None, Some(start));
            prev = Some(t);
        }
        let t_last = tel("2026-05-09T12:00:05.001Z", 3000, 50.0);
        let alerts = classify(
            &t_last,
            prev.as_ref(),
            TruckState::Hauling,
            None,
            Some(start),
        );
        assert!(alerts.contains(&HealthAlert::OverRev));
    }

    #[test]
    fn fuel_anomaly_when_drop_exceeds_ten_in_under_thirty_seconds() {
        let prev = tel("2026-05-09T00:00:00Z", 1000, 50.0);
        let cur = tel("2026-05-09T00:00:10Z", 1000, 35.0);
        let alerts = classify(&cur, Some(&prev), TruckState::Idle, None, None);
        assert!(alerts.contains(&HealthAlert::FuelAnomaly));
    }
}
