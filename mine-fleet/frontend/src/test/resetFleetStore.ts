import { useFleetStore } from "../store/fleetStore";

/** Partial reset of client state between tests (actions preserved by Zustand merge). */
export function resetFleetStore(): void {
  useFleetStore.setState({
    vehicles: {},
    historyByTruck: {},
    historyApiHydrated: {},
    lastUpdateAt: null,
    selectedTruckId: null,
    scrubIndex: 0,
    scrubPlaying: false,
  });
}
