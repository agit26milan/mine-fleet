import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFleetSse } from "./useFleetSse";
import { resetFleetStore } from "../test/resetFleetStore";

const instances: Array<{
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}> = [];

beforeEach(() => {
  resetFleetStore();
  instances.length = 0;
  vi.useFakeTimers();

  class MockEventSource {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    close = vi.fn();
    constructor(public url: string) {
      instances.push(this);
    }
    addEventListener() {}
    removeEventListener() {}
  }

  vi.stubGlobal(
    "EventSource",
    MockEventSource as unknown as typeof EventSource,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useFleetSse", () => {
  it("opens a new EventSource after onerror and 3s delay", () => {
    const { unmount } = renderHook(() => useFleetSse());

    expect(instances.length).toBeGreaterThanOrEqual(1);
    const first = instances[0]!;

    act(() => {
      first.onerror?.call(first as unknown as EventSource);
    });

    expect(first.close).toHaveBeenCalled();

    const countAfterError = instances.length;

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(instances.length).toBeGreaterThan(countAfterError);

    unmount();
  });
});
