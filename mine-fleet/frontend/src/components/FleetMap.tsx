import { MapContainer, Polyline, TileLayer } from "react-leaflet";

import {
  EMPTY_TELEMETRY_HISTORY,
  TRAIL_POINT_COUNT,
  useFleetStore,
} from "../store/fleetStore";
import { TruckMarker } from "./TruckMarker";

/** Simulator area (~Bali latitudes). */
const DEFAULT_CENTER: [number, number] = [-8.5, 115.2];
const DEFAULT_ZOOM = 14;

type Props = {
  onSelectTruck: (id: string) => void;
};

export function FleetMap({ onSelectTruck }: Props) {
  const vehicles = useFleetStore((s) => s.vehicles);
  const list = Object.values(vehicles);
  const selectedId = useFleetStore((s) => s.selectedTruckId);
  const scrubIndex = useFleetStore((s) => s.scrubIndex);
  const historyByTruck = useFleetStore((s) => s.historyByTruck);

  const selectedHistory = selectedId
    ? (historyByTruck[selectedId] ?? EMPTY_TELEMETRY_HISTORY)
    : EMPTY_TELEMETRY_HISTORY;
  const trailPositions: [number, number][] =
    selectedHistory.length >= 2
      ? selectedHistory
          .slice(-TRAIL_POINT_COUNT)
          .map((t) => [t.lat, t.lon] as [number, number])
      : [];

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {trailPositions.length >= 2 && (
        <Polyline
          positions={trailPositions}
          pathOptions={{
            color: "#1d4ed8",
            weight: 4,
            opacity: 0.88,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      )}
      {list.map((v) => {
        const hist = historyByTruck[v.truck_id] ?? EMPTY_TELEMETRY_HISTORY;
        let positionOverride: { lat: number; lon: number } | undefined;
        if (
          v.truck_id === selectedId &&
          hist.length > 0 &&
          scrubIndex >= 0 &&
          scrubIndex < hist.length
        ) {
          const t = hist[scrubIndex];
          positionOverride = { lat: t.lat, lon: t.lon };
        }
        return (
          <TruckMarker
            key={v.truck_id}
            vehicle={v}
            positionOverride={positionOverride}
            onSelect={onSelectTruck}
          />
        );
      })}
    </MapContainer>
  );
}
