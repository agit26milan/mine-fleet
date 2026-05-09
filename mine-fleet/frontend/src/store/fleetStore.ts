import { create } from "zustand";

import type { FleetSnapshot, Telemetry, VehicleState } from "../types";

export const HISTORY_CAP = 300;
export const TRAIL_POINT_COUNT = 50;

/** Stable empty reference for Zustand selectors (never `[]` inline — breaks useSyncExternalStore). */
export const EMPTY_TELEMETRY_HISTORY: Telemetry[] = [];

export type FleetStateSlice = {
  vehicles: Record<string, VehicleState>;
  historyByTruck: Record<string, Telemetry[]>;
  /** Server GET /history applied at least once for this truck id. */
  historyApiHydrated: Record<string, boolean>;
  lastUpdateAt: string | null;
  selectedTruckId: string | null;
  /** Index into `historyByTruck[selectedTruckId]` (0 = oldest in buffer). */
  scrubIndex: number;
  scrubPlaying: boolean;

  updateVehicle: (v: VehicleState) => void;
  applyVehicleBatch: (batch: Record<string, VehicleState>) => void;
  setSnapshot: (s: FleetSnapshot) => void;
  setSelectedTruckId: (id: string | null) => void;
  setScrubIndex: (i: number) => void;
  setScrubPlaying: (on: boolean) => void;
  tickScrubPlayback: () => void;
  seedHistoryFromServer: (truckId: string, entries: Telemetry[]) => void;
  markHistoryHydrated: (truckId: string) => void;
};

function maxIso(a: string | null, b: string): string {
  if (!a) return b;
  return b > a ? b : a;
}

export const useFleetStore = create<FleetStateSlice>((set) => ({
  vehicles: {},
  historyByTruck: {},
  historyApiHydrated: {},
  lastUpdateAt: null,
  selectedTruckId: null,
  scrubIndex: 0,
  scrubPlaying: false,

  updateVehicle: (v) =>
    set((s) => {
      const prevH = s.historyByTruck[v.truck_id] ?? [];
      const followLive =
        s.selectedTruckId === v.truck_id &&
        prevH.length > 0 &&
        s.scrubIndex === prevH.length - 1;
      const nextH = [...prevH, v.telemetry];
      const trimmed =
        nextH.length > HISTORY_CAP ? nextH.slice(-HISTORY_CAP) : nextH;
      let scrubIndex = s.scrubIndex;
      if (followLive) scrubIndex = trimmed.length - 1;
      return {
        vehicles: { ...s.vehicles, [v.truck_id]: v },
        historyByTruck: { ...s.historyByTruck, [v.truck_id]: trimmed },
        lastUpdateAt: maxIso(s.lastUpdateAt, v.telemetry.timestamp),
        scrubIndex,
      };
    }),

  applyVehicleBatch: (batch) =>
    set((s) => {
      if (Object.keys(batch).length === 0) return s;
      const vehicles = { ...s.vehicles, ...batch };
      const historyByTruck = { ...s.historyByTruck };
      let scrubIndex = s.scrubIndex;
      let last = s.lastUpdateAt;

      for (const v of Object.values(batch)) {
        last = maxIso(last, v.telemetry.timestamp);
        const tid = v.truck_id;
        const prevH = historyByTruck[tid] ?? [];
        const followLive =
          s.selectedTruckId === tid &&
          prevH.length > 0 &&
          scrubIndex === prevH.length - 1;
        const nextH = [...prevH, v.telemetry];
        const trimmed =
          nextH.length > HISTORY_CAP ? nextH.slice(-HISTORY_CAP) : nextH;
        historyByTruck[tid] = trimmed;
        if (followLive) scrubIndex = trimmed.length - 1;
      }

      return {
        vehicles,
        historyByTruck,
        lastUpdateAt: last,
        scrubIndex,
      };
    }),

  setSnapshot: (snap) =>
    set((s) => {
      const vehicles: Record<string, VehicleState> = {};
      const historyByTruck = { ...s.historyByTruck };
      let last: string | null = s.lastUpdateAt;
      let scrubIndex = s.scrubIndex;

      for (const v of snap.vehicles) {
        vehicles[v.truck_id] = v;
        last = maxIso(last, v.telemetry.timestamp);
        const prev = historyByTruck[v.truck_id] ?? [];
        const lastTs = prev[prev.length - 1]?.timestamp;
        if (lastTs !== v.telemetry.timestamp) {
          const nextH = [...prev, v.telemetry];
          historyByTruck[v.truck_id] =
            nextH.length > HISTORY_CAP ? nextH.slice(-HISTORY_CAP) : nextH;
        }
        if (s.selectedTruckId === v.truck_id) {
          const h = historyByTruck[v.truck_id] ?? [];
          if (h.length > 0) scrubIndex = h.length - 1;
        }
      }

      return { vehicles, historyByTruck, lastUpdateAt: last, scrubIndex };
    }),

  setSelectedTruckId: (id) =>
    set((s) => {
      if (id === null) {
        return { selectedTruckId: null, scrubPlaying: false, scrubIndex: 0 };
      }
      const len = s.historyByTruck[id]?.length ?? 0;
      return {
        selectedTruckId: id,
        scrubPlaying: false,
        scrubIndex: len > 0 ? len - 1 : 0,
      };
    }),

  setScrubIndex: (i) =>
    set((s) => {
      const id = s.selectedTruckId;
      const len = id ? (s.historyByTruck[id]?.length ?? 0) : 0;
      const max = Math.max(0, len - 1);
      const clamped = Math.max(0, Math.min(i, max));
      return { scrubIndex: clamped, scrubPlaying: false };
    }),

  setScrubPlaying: (on) => set({ scrubPlaying: on }),

  tickScrubPlayback: () =>
    set((s) => {
      if (!s.scrubPlaying || !s.selectedTruckId) return s;
      const h = s.historyByTruck[s.selectedTruckId] ?? [];
      if (h.length < 2) return { scrubPlaying: false };
      const next = s.scrubIndex + 1;
      if (next >= h.length) {
        return { scrubIndex: h.length - 1, scrubPlaying: false };
      }
      return { scrubIndex: next };
    }),

  seedHistoryFromServer: (truckId, entries) =>
    set((s) => {
      const trimmed = entries.slice(-HISTORY_CAP);
      const historyByTruck = { ...s.historyByTruck, [truckId]: trimmed };
      let scrubIndex = s.scrubIndex;
      if (s.selectedTruckId === truckId && trimmed.length > 0) {
        scrubIndex = trimmed.length - 1;
      }
      return { historyByTruck, scrubIndex };
    }),

  markHistoryHydrated: (truckId) =>
    set((s) => ({
      historyApiHydrated: { ...s.historyApiHydrated, [truckId]: true },
    })),
}));
