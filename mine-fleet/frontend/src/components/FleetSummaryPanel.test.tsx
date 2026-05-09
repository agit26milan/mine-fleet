import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { TruckState, VehicleState } from "../types";
import { resetFleetStore } from "../test/resetFleetStore";
import { useFleetStore } from "../store/fleetStore";
import { FleetSummaryPanel } from "./FleetSummaryPanel";

function makeVehicle(id: string, state: TruckState): VehicleState {
  return {
    truck_id: id,
    state,
    telemetry: {
      truck_id: id,
      timestamp: "2026-05-09T00:00:00Z",
      lat: -8.5,
      lon: 115.2,
      speed_kmh: 0,
      rpm: 800,
      load_status: "Empty",
      fuel_pct: 80,
    },
    health_alerts: [],
  };
}

describe("FleetSummaryPanel", () => {
  beforeEach(() => {
    resetFleetStore();
    const idle: Record<string, VehicleState> = {};
    for (let i = 1; i <= 5; i++) {
      idle[`truck-${i}`] = makeVehicle(`truck-${i}`, "Idle");
    }
    useFleetStore.setState({ vehicles: idle });
  });

  it("shows Hauling: 2 after two trucks move to Hauling", () => {
    render(<FleetSummaryPanel />);
    const list = screen.getByRole("list");
    const rows = () => within(list).getAllByRole("listitem");
    expect(rows()[4]).toHaveTextContent(/Idle:\s*5/);

    act(() => {
      useFleetStore.setState((s) => ({
        vehicles: {
          ...s.vehicles,
          "truck-1": { ...s.vehicles["truck-1"]!, state: "Hauling" },
          "truck-2": { ...s.vehicles["truck-2"]!, state: "Hauling" },
        },
      }));
    });

    expect(rows()[1]).toHaveTextContent(/Hauling:\s*2/);
    expect(rows()[4]).toHaveTextContent(/Idle:\s*3/);
  });
});
