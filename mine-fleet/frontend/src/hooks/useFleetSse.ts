import { useEffect, useRef } from "react";

import { getBackendOrigin } from "../lib/backendUrl";
import type { FleetSnapshot, SseEvent, VehicleState } from "../types";
import { useFleetStore } from "../store/fleetStore";

const BATCH_MS = 100;
const RECONNECT_MS = 3000;

function parseSsePayload(raw: string): SseEvent | null {
  try {
    return JSON.parse(raw) as SseEvent;
  } catch {
    return null;
  }
}

export function useFleetSse(): void {
  const applyVehicleBatch = useFleetStore((s) => s.applyVehicleBatch);
  const setSnapshot = useFleetStore((s) => s.setSnapshot);

  const batchRef = useRef<Record<string, VehicleState>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const origin = getBackendOrigin();
    const url = `${origin}/events`;

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const pending = batchRef.current;
        batchRef.current = {};
        if (Object.keys(pending).length > 0) {
          applyVehicleBatch(pending);
        }
      }, BATCH_MS);
    };

    const handleMessage = (ev: MessageEvent<string>) => {
      if (ev.data === "keepalive" || !ev.data) return;
      const msg = parseSsePayload(ev.data);
      if (!msg) return;

      if ("TelemetryUpdate" in msg) {
        const v = msg.TelemetryUpdate;
        batchRef.current[v.truck_id] = v;
        scheduleFlush();
      } else if ("FleetSnapshot" in msg) {
        const snap: FleetSnapshot = msg.FleetSnapshot;
        setSnapshot(snap);
      }
    };

    const connect = () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      const es = new EventSource(url);
      esRef.current = es;
      es.onmessage = handleMessage;
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (reconnectRef.current !== null) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(() => {
          reconnectRef.current = null;
          connect();
        }, RECONNECT_MS);
      };
    };

    connect();

    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (reconnectRef.current !== null) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      const pending = batchRef.current;
      batchRef.current = {};
      if (Object.keys(pending).length > 0) {
        applyVehicleBatch(pending);
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [applyVehicleBatch, setSnapshot]);
}
