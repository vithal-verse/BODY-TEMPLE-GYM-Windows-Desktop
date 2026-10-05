"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { errorMessage } from "@/lib/api";
import { useRefreshVersion } from "@/components/session-provider";

/**
 * Loads data from the main process. Re-runs when `deps` change, when `reload()` is called, and whenever
 * anything calls the app-wide `refresh()` (the desktop equivalent of Next's router.refresh()).
 * Keeps showing the previous result while a refresh is in flight, so lists never flash empty.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const version = useRefreshVersion();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  const key = `${JSON.stringify(deps)}#${version}#${tick}`;
  const run = useEffectEvent(load);

  useEffect(() => {
    let live = true;
    run().then(
      (data) => live && setState({ key, data }),
      (e) => live && setState((s) => ({ key, data: s.data, error: errorMessage(e) }))
    );
    return () => {
      live = false;
    };
  }, [key]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data: state.data, error: state.key === key ? state.error : undefined, loading: state.key !== key, reload };
}
