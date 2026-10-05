"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Opts = { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Pending = Opts & { kind: "confirm" | "alert"; message: string; resolve: (ok: boolean) => void };
type Dialogs = {
  confirm: (message: string, opts?: Opts) => Promise<boolean>;
  alert: (message: string, opts?: Opts) => Promise<void>;
};

const Ctx = createContext<Dialogs | null>(null);

/**
 * In-app replacements for window.confirm / window.alert. Native browser dialogs are blocking and, in
 * Electron on Windows, can leave text inputs unable to receive focus afterwards.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const primary = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<Dialogs["confirm"]>((message, opts) => new Promise((resolve) => setPending({ kind: "confirm", message, resolve, ...opts })), []);
  const alert = useCallback<Dialogs["alert"]>((message, opts) => new Promise<void>((resolve) => setPending({ kind: "alert", message, resolve: () => resolve(), ...opts })), []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pending.resolve(false);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  return (
    <Ctx.Provider value={{ confirm, alert }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 p-4" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" className="w-full max-w-md border-2 border-ink-line bg-ink-raised p-6 shadow-2xl">
            <h3 id="dlg-title" className="font-display text-xl text-paper">
              {pending.title ?? (pending.kind === "confirm" ? "Are you sure?" : "Heads up")}
            </h3>
            <p className="mt-2 whitespace-pre-line font-body text-sm leading-relaxed text-paper/70">{pending.message}</p>
            <div className="mt-6 flex justify-end gap-3">
              {pending.kind === "confirm" && (
                <button onClick={() => close(false)} className="border-2 border-ink-line px-4 py-2 font-body text-sm font-medium text-paper/70 transition-colors hover:border-paper/40">
                  {pending.cancelLabel ?? "Cancel"}
                </button>
              )}
              <button
                ref={primary}
                onClick={() => close(true)}
                className={`px-4 py-2 font-display text-base tracking-wide text-ink transition-colors ${pending.danger ? "bg-alert hover:bg-alert/80" : "bg-mango hover:bg-mango-deep"}`}
              >
                {pending.confirmLabel ?? (pending.kind === "confirm" ? "Confirm" : "OK")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useDialog(): Dialogs {
  const c = useContext(Ctx);
  if (!c) throw new Error("DialogProvider is missing");
  return c;
}
