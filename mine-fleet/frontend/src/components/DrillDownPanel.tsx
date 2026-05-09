import { useEffect } from "react";

import { getBackendOrigin } from "../lib/backendUrl";
import type { Telemetry } from "../types";
import { HISTORY_CAP, useFleetStore } from "../store/fleetStore";

export function DrillDownPanel() {
  const selectedId = useFleetStore((s) => s.selectedTruckId);
  const vehicle = useFleetStore((s) =>
    selectedId ? s.vehicles[selectedId] : undefined,
  );
  const history = useFleetStore((s) =>
    selectedId ? (s.historyByTruck[selectedId] ?? []) : [],
  );
  const scrubIndex = useFleetStore((s) => s.scrubIndex);
  const scrubPlaying = useFleetStore((s) => s.scrubPlaying);
  const historyHydratedForSelected = useFleetStore((s) =>
    selectedId ? Boolean(s.historyApiHydrated[selectedId]) : false,
  );

  const setSelected = useFleetStore((s) => s.setSelectedTruckId);
  const setScrubIndex = useFleetStore((s) => s.setScrubIndex);
  const setScrubPlaying = useFleetStore((s) => s.setScrubPlaying);
  const tickScrubPlayback = useFleetStore((s) => s.tickScrubPlayback);
  const seedHistoryFromServer = useFleetStore((s) => s.seedHistoryFromServer);
  const markHistoryHydrated = useFleetStore((s) => s.markHistoryHydrated);

  useEffect(() => {
    if (!selectedId || historyHydratedForSelected) return;

    const origin = getBackendOrigin();
    let cancelled = false;
    const id = selectedId;

    void (async () => {
      try {
        const res = await fetch(
          `${origin}/vehicles/${encodeURIComponent(id)}/history`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Telemetry[];
        if (cancelled) return;
        seedHistoryFromServer(id, data);
        markHistoryHydrated(id);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedId,
    historyHydratedForSelected,
    seedHistoryFromServer,
    markHistoryHydrated,
  ]);

  useEffect(() => {
    if (!scrubPlaying || !selectedId) return;
    const timer = window.setInterval(() => {
      tickScrubPlayback();
    }, 250);
    return () => clearInterval(timer);
  }, [scrubPlaying, selectedId, tickScrubPlayback]);

  if (!vehicle) return null;

  const histLen = history.length;
  const maxSlider = Math.max(0, Math.min(HISTORY_CAP - 1, histLen - 1));
  const safeIndex = Math.max(0, Math.min(scrubIndex, Math.max(0, histLen - 1)));
  const atLiveEdge = histLen === 0 || safeIndex >= histLen - 1;
  const tel: Telemetry =
    histLen > 0 && !atLiveEdge ? history[safeIndex]! : vehicle.telemetry;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        width: 300,
        maxHeight: "78vh",
        overflow: "auto",
        background: "rgba(255,255,255,0.96)",
        borderRadius: 8,
        padding: "12px 14px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span style={{ fontWeight: 700 }}>{vehicle.truck_id}</span>
        <button
          type="button"
          onClick={() => setSelected(null)}
          style={{
            border: "none",
            background: "#e5e7eb",
            borderRadius: 4,
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Close
        </button>
      </div>

      {!atLiveEdge && (
        <div
          style={{
            fontSize: 11,
            color: "#b45309",
            marginBottom: 8,
            fontWeight: 600,
          }}
        >
          Scrubbing history (sample {safeIndex + 1} / {histLen})
        </div>
      )}

      <dl style={{ margin: 0, display: "grid", rowGap: 6 }}>
        {atLiveEdge ? (
          <>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>State</dt>
              <dd style={{ margin: 0 }}>{vehicle.state}</dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Speed / RPM</dt>
              <dd style={{ margin: 0 }}>
                {vehicle.telemetry.speed_kmh.toFixed(1)} km/h ·{" "}
                {vehicle.telemetry.rpm} rpm
              </dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Fuel / Load</dt>
              <dd style={{ margin: 0 }}>
                {vehicle.telemetry.fuel_pct.toFixed(1)}% ·{" "}
                {vehicle.telemetry.load_status}
              </dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Alerts</dt>
              <dd style={{ margin: 0 }}>
                {vehicle.health_alerts.length === 0
                  ? "None"
                  : vehicle.health_alerts.join(", ")}
              </dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Telemetry time</dt>
              <dd style={{ margin: 0 }}>{vehicle.telemetry.timestamp}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Telemetry time</dt>
              <dd style={{ margin: 0 }}>{tel.timestamp}</dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Speed / RPM</dt>
              <dd style={{ margin: 0 }}>
                {tel.speed_kmh.toFixed(1)} km/h · {tel.rpm} rpm
              </dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Fuel / Load</dt>
              <dd style={{ margin: 0 }}>
                {tel.fuel_pct.toFixed(1)}% · {tel.load_status}
              </dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280", fontSize: 11 }}>Position</dt>
              <dd style={{ margin: 0 }}>
                {tel.lat.toFixed(5)}, {tel.lon.toFixed(5)}
              </dd>
            </div>
          </>
        )}
      </dl>

      <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
          History ({histLen} / {HISTORY_CAP})
        </div>
        <label htmlFor="history-scrub" style={{ fontSize: 11, color: "#6b7280" }}>
          Scrub (0–{maxSlider})
        </label>
        <input
          id="history-scrub"
          type="range"
          min={0}
          max={maxSlider}
          step={1}
          value={histLen === 0 ? 0 : safeIndex}
          disabled={histLen < 2}
          onChange={(e) => setScrubIndex(Number(e.target.value))}
          style={{ width: "100%", marginTop: 4 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setScrubPlaying(!scrubPlaying)}
            disabled={histLen < 2}
            style={{
              flex: 1,
              padding: "8px 10px",
              border: "none",
              borderRadius: 6,
              background: scrubPlaying ? "#fca5a5" : "#93c5fd",
              cursor: histLen < 2 ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {scrubPlaying ? "Pause" : "Play 2×"}
          </button>
          <button
            type="button"
            onClick={() => setScrubIndex(maxSlider)}
            disabled={histLen < 1}
            style={{
              padding: "8px 10px",
              border: "none",
              borderRadius: 6,
              background: "#e5e7eb",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Latest
          </button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 10, color: "#9ca3af" }}>
          Trail on map: last {Math.min(50, histLen)} points. Playback advances
          every 250 ms (2× vs 500 ms live).
        </p>
      </div>
    </div>
  );
}
