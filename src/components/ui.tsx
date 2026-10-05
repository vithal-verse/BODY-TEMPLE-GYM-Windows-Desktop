"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const inputClass =
  "w-full border-2 border-ink-line bg-ink px-4 py-3 font-body text-paper placeholder:text-paper/30 outline-none transition-colors focus:border-mango disabled:opacity-50";
export const labelClass = "font-body text-sm font-medium text-paper/80";

export function Field({ label, hint, className, ...props }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = props.id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input id={id} {...props} className={inputClass} />
      {hint && <p className="font-body text-xs text-paper/40">{hint}</p>}
    </div>
  );
}

export function PasswordField({ label, hint, ...props }: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  const id = props.id ?? `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="relative">
        <input id={id} {...props} type={show ? "text" : "password"} className={cn(inputClass, "pr-12")} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-paper/40 hover:text-mango">
          {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {hint && <p className="font-body text-xs text-paper/40">{hint}</p>}
    </div>
  );
}

export function PrimaryButton({ busy, children, className, ...props }: { busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} disabled={busy || props.disabled}
      className={cn("flex items-center justify-center gap-2 bg-mango px-6 py-3 font-display text-base tracking-wide text-ink transition-colors hover:bg-mango-deep disabled:cursor-not-allowed disabled:opacity-60", className)}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function GhostButton({ busy, children, className, danger, ...props }: { busy?: boolean; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} disabled={busy || props.disabled}
      className={cn("flex items-center justify-center gap-2 border-2 px-4 py-2.5 font-body text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "border-alert/60 text-alert hover:bg-alert hover:text-ink" : "border-ink-line text-paper/70 hover:border-mango hover:text-mango", className)}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="border-l-4 border-alert bg-alert/10 px-4 py-3 font-body text-sm text-alert">{children}</p>;
}

export function OkNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="status" className="border-l-4 border-good bg-good/10 px-4 py-3 font-body text-sm text-good">{children}</p>;
}

/** Shows a one-time recovery code and makes the person acknowledge saving it before continuing. */
export function RecoveryCodeNotice({ code, onDone, doneLabel = "Continue" }: { code: string; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="font-display text-xl text-paper">Save your recovery code</h3>
        <p className="mt-2 font-body text-sm leading-relaxed text-paper/60">
          This works fully offline, so there is no &ldquo;email me a reset link&rdquo;. If the password is ever forgotten, this code is the
          only way back in. It&apos;s shown <strong className="text-paper">once</strong> — write it down or store it somewhere safe, away from this PC.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 border-2 border-mango bg-ink px-4 py-4">
        <code className="select-all break-all font-mono text-lg tracking-widest text-mango">{code}</code>
        <button type="button" aria-label="Copy recovery code"
          onClick={() => void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
          className="flex shrink-0 items-center gap-1.5 border-2 border-ink-line px-3 py-1.5 font-body text-xs text-paper/70 hover:border-mango hover:text-mango">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <label className="flex items-start gap-3 font-body text-sm text-paper/80">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#FFC22C]" />
        I&apos;ve saved this code somewhere safe.
      </label>
      <PrimaryButton type="button" disabled={!saved} onClick={onDone}>{doneLabel}</PrimaryButton>
    </div>
  );
}
