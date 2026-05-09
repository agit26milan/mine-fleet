//! Server-Sent Events fan-out for fleet updates.

use std::convert::Infallible;
use std::time::Duration;

use async_stream::stream;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use tokio::sync::broadcast::error::RecvError;

use crate::app::AppState;

/// Bounded fan-out for live telemetry: capacity **256** slots.
///
/// When every subscriber is slow (or offline), the buffer fills; **the oldest event is dropped**
/// so publishers never block and memory stays bounded. For live fleet tracking, slightly stale data
/// is acceptable; blocking the ingest path would be worse than skipping old frames.
pub const SSE_BROADCAST_CAPACITY: usize = 256;

pub async fn events(State(app): State<AppState>) -> impl IntoResponse {
    let mut rx = app.sse_tx.subscribe();

    let body = stream! {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let json = match serde_json::to_string(&ev) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::warn!(error = %e, "sse skip: serialize failed");
                            continue;
                        }
                    };
                    yield Ok::<Event, Infallible>(Event::default().data(json));
                }
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped = skipped, "sse client lagged; continuing");
                }
                Err(RecvError::Closed) => break,
            }
        }
    };

    Sse::new(body).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{FleetSnapshot, SseEvent};

    #[tokio::test]
    async fn broadcast_continues_when_one_receiver_dropped() {
        let (tx, _) = tokio::sync::broadcast::channel::<SseEvent>(SSE_BROADCAST_CAPACITY);
        let mut r1 = tx.subscribe();
        let r2 = tx.subscribe();
        drop(r2);

        tx.send(SseEvent::FleetSnapshot(FleetSnapshot { vehicles: vec![] }))
            .unwrap();

        let ev = r1.recv().await.unwrap();
        assert!(matches!(ev, SseEvent::FleetSnapshot(_)));
    }

    #[tokio::test]
    async fn second_receiver_still_gets_events_after_first_dropped() {
        let (tx, _) = tokio::sync::broadcast::channel::<SseEvent>(SSE_BROADCAST_CAPACITY);
        let r1 = tx.subscribe();
        drop(r1);

        let mut r2 = tx.subscribe();
        let snap = FleetSnapshot { vehicles: vec![] };
        tx.send(SseEvent::FleetSnapshot(snap)).unwrap();

        let got = r2.recv().await.unwrap();
        assert!(matches!(got, SseEvent::FleetSnapshot(_)));
    }

    /// Two subscribers; drop one; remaining client still receives new sends (no panic).
    #[tokio::test]
    async fn two_receivers_drop_one_other_still_receives() {
        let (tx, _) = tokio::sync::broadcast::channel::<SseEvent>(SSE_BROADCAST_CAPACITY);
        let mut a = tx.subscribe();
        let b = tx.subscribe();

        tx.send(SseEvent::FleetSnapshot(FleetSnapshot { vehicles: vec![] }))
            .unwrap();
        let _ = a.recv().await.unwrap();
        drop(b);

        tx.send(SseEvent::FleetSnapshot(FleetSnapshot { vehicles: vec![] }))
            .unwrap();
        let ev = a.recv().await.unwrap();
        assert!(matches!(ev, SseEvent::FleetSnapshot(_)));
    }
}
