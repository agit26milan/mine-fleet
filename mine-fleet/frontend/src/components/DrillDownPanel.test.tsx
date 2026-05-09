import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Telemetry, VehicleState } from "../types";
import { useFleetStore } from "../store/fleetStore";
import { resetFleetStore } from "../test/resetFleetStore";
import { DrillDownPanel } from "./DrillDownPanel";

function telemetryAtIndex(i: number): Telemetry {
  return {
    truck_id: "truck-1",
    timestamp: new Date(Date.UTC(2026, 4, 9, 12, 0, i)).toISOString(),
    lat: -8.5 + i * 1e-5,
    lon: 115.2,
    speed_kmh: i,
    rpm: 1000 + i,
    load_status: "Empty",
    fuel_pct: 90,
  };
}

describe("DrillDownPanel history scrubber", () => {
  beforeEach(() => {
    resetFleetStore();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows telemetry at scrub index 150 when slider moves to 150 (300 samples)", async () => {
    const history: Telemetry[] = Array.from({ length: 300 }, (_, i) =>
      telemetryAtIndex(i),
    );
    const vehicle: VehicleState = {
      truck_id: "truck-1",
      state: "Idle",
      telemetry: history[299]!,
      health_alerts: [],
    };

    useFleetStore.setState({
      vehicles: { "truck-1": vehicle },
      historyByTruck: { "truck-1": history },
      selectedTruckId: "truck-1",
      scrubIndex: 299,
      historyApiHydrated: { "truck-1": true },
    });

    render(<DrillDownPanel />);

    await waitFor(() => {
      expect(screen.getByRole("slider")).toBeInTheDocument();
    });

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "150" } });

    expect(screen.getByText(/Scrubbing history/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${history[150]!.speed_kmh.toFixed(1)} km/h`)),
    ).toBeInTheDocument();
    expect(screen.getByText(history[150]!.timestamp)).toBeInTheDocument();
  });
});
