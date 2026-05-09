import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import { useEffect, useRef } from "react";
import { CircleMarker, Tooltip } from "react-leaflet";

import type { VehicleState } from "../types";
import { markerColorForVehicle } from "./markerColors";

type Props = {
  vehicle: VehicleState;
  /** When set (e.g. history scrub), marker uses this position instead of live telemetry. */
  positionOverride?: { lat: number; lon: number };
  onSelect: (id: string) => void;
};

export function TruckMarker({ vehicle, positionOverride, onSelect }: Props) {
  const ref = useRef<LeafletCircleMarker>(null);
  const lat = positionOverride?.lat ?? vehicle.telemetry.lat;
  const lon = positionOverride?.lon ?? vehicle.telemetry.lon;
  const color = markerColorForVehicle(vehicle);

  useEffect(() => {
    ref.current?.setLatLng([lat, lon]);
  }, [lat, lon]);

  return (
    <CircleMarker
      ref={ref}
      center={[lat, lon]}
      radius={9}
      pathOptions={{
        color: "#1f2937",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.92,
      }}
      eventHandlers={{
        click: () => {
          onSelect(vehicle.truck_id);
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -6]} opacity={0.95} permanent>
        {vehicle.truck_id}
      </Tooltip>
    </CircleMarker>
  );
}
