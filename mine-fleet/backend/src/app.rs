use std::sync::Arc;

use tokio::sync::broadcast;
use tokio::sync::RwLock;

use crate::state::FleetState;
use crate::types::SseEvent;

#[derive(Clone)]
pub struct AppState {
    pub fleet: Arc<RwLock<FleetState>>,
    pub sse_tx: Arc<broadcast::Sender<SseEvent>>,
}
