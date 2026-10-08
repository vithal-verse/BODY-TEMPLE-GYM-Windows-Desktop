"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionInfo } from "@shared/types";
import { api } from "@/lib/api";
import { PageState } from "@/components/page-state";

type State = { loading: boolean; hasAdmin: boolean; session: SessionInfo | null };
type Ctx = {
  state: State;
  setSession: (s: SessionInfo) => void;
  signOut: () => Promise<void>;
  recheck: () => Promise<void>;
  version: number;
  refresh: () => void;
};

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ loading: true, hasAdmin: true, session: null });
  const [version, setVersion] = useState(0);

  const recheck = useCallback(async () => {
    try {
      const s = await api.auth.status();
      setState({ loading: false, hasAdmin: s.hasAdmin, session: s.session });
    } catch {
      setState({ loading: false, hasAdmin: true, session: null });
    }
  }, []);

  useEffect(() => {
    let live = true;
    api.auth.status().then(
      (s) => live && setState({ loading: false, hasAdmin: s.hasAdmin, session: s.session }),
      () => live && setState({ loading: false, hasAdmin: true, session: null })
    );
    return () => {
      live = false;
    };
  }, []);

  // The main process tells us when the session was ended underneath us (e.g. after a restore).
  useEffect(() => window.gym?.events.onSessionEnded(() => void recheck()), [recheck]);
  // ...and when a menu item (File → Backup & restore…) wants a particular screen.
  useEffect(() => window.gym?.events.onNavigate((p) => router.push(p)), [router]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      version,
      refresh: () => setVersion((v) => v + 1),
      setSession: (session) => setState({ loading: false, hasAdmin: true, session }),
      recheck,
      signOut: async () => {
        await api.auth.logout().catch(() => undefined);
        setState((s) => ({ ...s, session: null }));
        router.replace("/login/");
      },
    }),
    [state, version, recheck, router]
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider is missing");
  return c;
}
export const useSession = () => useCtx();
/** Call after a change to re-fetch whatever is on screen (replaces router.refresh()). */
export const useRefresh = () => useCtx().refresh;
export const useRefreshVersion = () => useCtx().version;

/** Wraps screens that need a signed-in admin; sends everyone else to setup or login. */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.loading) return;
    if (!state.hasAdmin) router.replace("/setup/");
    else if (!state.session) router.replace("/login/");
  }, [state, router]);
  if (state.loading || !state.session) return <PageState label="Opening Body Temple Gym…" />;
  return <>{children}</>;
}

/** For setup/login screens: if the visitor is already signed in (or setup is needed) go where they belong. */
export function useRedirectIfSignedIn(page: "login" | "setup") {
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.loading) return;
    if (state.session) router.replace("/dashboard/");
    else if (page === "login" && !state.hasAdmin) router.replace("/setup/");
    else if (page === "setup" && state.hasAdmin) router.replace("/login/");
  }, [state, page, router]);
  return state;
}
