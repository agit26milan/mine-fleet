import { MapContainer, TileLayer } from "react-leaflet";

import { useFleetStore } from "../store/fleetStore";
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
      {list.map((v) => (
        <TruckMarker key={v.truck_id} vehicle={v} onSelect={onSelectTruck} />
      ))}
    </MapContainer>
  );
}
