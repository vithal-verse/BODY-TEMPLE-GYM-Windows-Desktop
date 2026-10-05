"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { passwordProblem } from "@shared/validation";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { ErrorNote, Field, PasswordField, PrimaryButton, RecoveryCodeNotice } from "@/components/ui";

export default function SetupForm() {
  const router = useRouter();
  const { setSession } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string; session: Awaited<ReturnType<typeof api.auth.login>> } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password, email);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const r = await api.auth.setup({ full_name: name, email, password });
      setDone({ code: r.recoveryCode, session: r.session });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-8">
        <RecoveryCodeNotice
          code={done.code}
          doneLabel="Open the dashboard"
          onDone={() => {
            setSession(done.session);
            router.replace("/dashboard/");
          }}
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
      <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Vithal" />
      <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@bodytemplegym.com" />
      <PasswordField label="Password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="At least 8 characters. Avoid common passwords." />
      <PasswordField label="Confirm password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      <ErrorNote>{error}</ErrorNote>
      <PrimaryButton type="submit" busy={busy} className="mt-2 py-3.5 text-lg">
        {busy ? "Creating…" : "Create account"}
      </PrimaryButton>
    </form>
  );
}
