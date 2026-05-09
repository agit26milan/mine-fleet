import { create } from "zustand";

import type { FleetSnapshot, VehicleState } from "../types";

export type FleetStateSlice = {
  vehicles: Record<string, VehicleState>;
  lastUpdateAt: string | null;
  selectedTruckId: string | null;
  updateVehicle: (v: VehicleState) => void;
  applyVehicleBatch: (batch: Record<string, VehicleState>) => void;
  setSnapshot: (s: FleetSnapshot) => void;
  setSelectedTruckId: (id: string | null) => void;
};

function maxIso(a: string | null, b: string): string {
  if (!a) return b;
  return b > a ? b : a;
}

export const useFleetStore = create<FleetStateSlice>((set) => ({
  vehicles: {},
  lastUpdateAt: null,
  selectedTruckId: null,

  updateVehicle: (v) =>
    set((s) => ({
      vehicles: { ...s.vehicles, [v.truck_id]: v },
      lastUpdateAt: maxIso(s.lastUpdateAt, v.telemetry.timestamp),
    })),

  applyVehicleBatch: (batch) =>
    set((s) => {
      if (Object.keys(batch).length === 0) return s;
      let last = s.lastUpdateAt;
      for (const v of Object.values(batch)) {
        last = maxIso(last, v.telemetry.timestamp);
      }
      return {
        vehicles: { ...s.vehicles, ...batch },
        lastUpdateAt: last,
      };
    }),

  setSnapshot: (snap) =>
    set(() => {
      const vehicles: Record<string, VehicleState> = {};
      let last: string | null = null;
      for (const v of snap.vehicles) {
        vehicles[v.truck_id] = v;
        last = maxIso(last, v.telemetry.timestamp);
      }
      return { vehicles, lastUpdateAt: last };
    }),

  setSelectedTruckId: (id) => set({ selectedTruckId: id }),
}));
