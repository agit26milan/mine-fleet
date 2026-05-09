mod api;
mod health;
mod state;
mod types;

use std::sync::Arc;

use api::AppState;
use state::FleetState;
use std::net::SocketAddr;
use tokio::sync::RwLock;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let app_state = AppState {
        fleet: Arc::new(RwLock::new(FleetState::new())),
    };

    let app = api::router(app_state);
    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    tracing::info!("backend listening on {}", addr);
    axum::serve(listener, app).await.unwrap();
}
