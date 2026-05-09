import { useFleetStore } from "../store/fleetStore";

export function DrillDownPanel() {
  const selectedId = useFleetStore((s) => s.selectedTruckId);
  const vehicle = useFleetStore((s) =>
    selectedId ? s.vehicles[selectedId] : undefined,
  );
  const setSelected = useFleetStore((s) => s.setSelectedTruckId);

  if (!vehicle) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        width: 280,
        maxHeight: "70vh",
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
      <dl style={{ margin: 0, display: "grid", rowGap: 6 }}>
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
      </dl>
      <p style={{ margin: "12px 0 0", fontSize: 11, color: "#9ca3af" }}>
        Trail and history scrubber come in the next step.
      </p>
    </div>
  );
}
