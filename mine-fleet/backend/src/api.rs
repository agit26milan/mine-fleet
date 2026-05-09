use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::app::AppState;
use crate::state::{FleetState, UpdateVehicleError};
use crate::types::{FleetSnapshot, SseEvent, Telemetry, VehicleState};

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error(transparent)]
    Json(#[from] axum::extract::rejection::JsonRejection),
    #[error("timestamp must be valid RFC3339 / ISO8601 UTC")]
    InvalidTimestamp,
}

impl From<UpdateVehicleError> for ApiError {
    fn from(err: UpdateVehicleError) -> Self {
        match err {
            UpdateVehicleError::InvalidTimestamp => ApiError::InvalidTimestamp,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            ApiError::Json(_) | ApiError::InvalidTimestamp => StatusCode::UNPROCESSABLE_ENTITY,
        };
        let body = self.to_string();
        (status, body).into_response()
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_ok))
        .route("/telemetry", post(post_telemetry))
        .route("/fleet", get(get_fleet))
        .route("/events", get(crate::sse::events))
        .with_state(state)
}

async fn health_ok() -> &'static str {
    "ok"
}

async fn post_telemetry(
    State(app): State<AppState>,
    Json(telemetry): Json<Telemetry>,
) -> Result<Json<VehicleState>, ApiError> {
    let vehicle = {
        let mut fleet = app.fleet.write().await;
        fleet.update_vehicle(telemetry)?
    };
    let _ = app
        .sse_tx
        .send(SseEvent::TelemetryUpdate(vehicle.clone()));
    Ok(Json(vehicle))
}

async fn get_fleet(State(app): State<AppState>) -> Json<FleetSnapshot> {
    let fleet = app.fleet.read().await;
    Json(fleet.get_snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::AppState;
    use axum::body::Body;
    use axum::http::Request;
    use axum::http::StatusCode;
    use tower::ServiceExt;

    use crate::state::FleetState;
    use crate::sse::SSE_BROADCAST_CAPACITY;

    fn test_app_state() -> AppState {
        let (sse_tx, _) = tokio::sync::broadcast::channel(SSE_BROADCAST_CAPACITY);
        AppState {
            fleet: Arc::new(RwLock::new(FleetState::new())),
            sse_tx: Arc::new(sse_tx),
        }
    }

    #[tokio::test]
    async fn post_telemetry_malformed_json_is_unprocessable() {
        let app = router(test_app_state());
        let req = Request::builder()
            .method("POST")
            .uri("/telemetry")
            .header("content-type", "application/json")
            .body(Body::from("{"))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn post_telemetry_invalid_timestamp_is_unprocessable() {
        let app = router(test_app_state());
        let body = serde_json::json!({
            "truck_id": "t1",
            "timestamp": "not-rfc3339",
            "lat": 0.0,
            "lon": 0.0,
            "speed_kmh": 0.0,
            "rpm": 0,
            "load_status": "Empty",
            "fuel_pct": 50.0
        })
        .to_string();
        let req = Request::builder()
            .method("POST")
            .uri("/telemetry")
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}
