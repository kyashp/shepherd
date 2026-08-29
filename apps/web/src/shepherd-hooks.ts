import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ShepherdEvent, ShepherdState } from "./types";

const messageFor = (reason: unknown): string =>
  reason instanceof Error ? reason.message : "The control plane did not return current data.";

export function useShepherdPolling(enabled = true) {
  const [state, setState] = useState<ShepherdState | null>(null);
  const [events, setEvents] = useState<ShepherdEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const cursorRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [stateResult, eventResult] = await Promise.all([
        api.shepherdState(),
        api.events(cursorRef.current),
      ]);
      if (!mountedRef.current) return;
      setState(stateResult.state);
      setEvents((current) => {
        const combined = cursorRef.current === 0
          ? [...stateResult.state.events, ...eventResult.events]
          : [...current, ...eventResult.events];
        return Array.from(new Map(combined.map((event) => [event.id, event])).values())
          .sort((left, right) => left.sequence - right.sequence)
          .slice(-500);
      });
      cursorRef.current = eventResult.nextCursor;
      setLastUpdated(new Date());
      setError(null);
    } catch (reason) {
      if (mountedRef.current) setError(messageFor(reason));
    } finally {
      if (mountedRef.current) setLoading(false);
      inFlightRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_100);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [enabled, refresh]);

  return {
    state,
    events,
    error,
    loading,
    lastUpdated,
    refresh,
    connected: state !== null && error === null,
  };
}
