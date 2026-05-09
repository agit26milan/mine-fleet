import "leaflet/dist/leaflet.css";

import { useFleetStore } from "./store/fleetStore";
import { useFleetSse } from "./hooks/useFleetSse";
import { useInitialFleet } from "./hooks/useInitialFleet";
import { FleetMap } from "./components/FleetMap";
import { FleetSummaryPanel } from "./components/FleetSummaryPanel";
import { DrillDownPanel } from "./components/DrillDownPanel";

export default function App() {
  useInitialFleet();
  useFleetSse();
  const setSelectedTruckId = useFleetStore((s) => s.setSelectedTruckId);

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        height: "100vh",
        width: "100vw",
        position: "relative",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <FleetMap onSelectTruck={setSelectedTruckId} />
      <FleetSummaryPanel />
      <DrillDownPanel />
    </div>
  );
}
