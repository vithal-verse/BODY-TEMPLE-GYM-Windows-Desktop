"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { passwordProblem } from "@shared/validation";
import AuthShell from "@/components/auth-shell";
import { PageState } from "@/components/page-state";
import { useRedirectIfSignedIn } from "@/components/session-provider";
import { api, errorMessage } from "@/lib/api";
import { ErrorNote, Field, PasswordField, PrimaryButton, RecoveryCodeNotice } from "@/components/ui";

function RecoverForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password, email);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      setNewCode((await api.auth.resetPassword({ email, recoveryCode: code, newPassword: password })).recoveryCode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (newCode) {
    return (
      <div className="mt-8">
        <p className="mb-5 border-l-4 border-good bg-good/10 px-4 py-3 font-body text-sm text-good">Password changed. Your old recovery code no longer works — here is a new one.</p>
        <RecoveryCodeNotice code={newCode} doneLabel="Back to sign in" onDone={() => router.replace("/login/")} />
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
      <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <Field label="Recovery code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} />
      <PasswordField label="New password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      <PasswordField label="Confirm new password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      <ErrorNote>{error}</ErrorNote>
      <PrimaryButton type="submit" busy={busy} className="mt-2 py-3.5 text-lg">Reset password</PrimaryButton>
      <Link href="/login/" className="self-center font-body text-sm text-paper/45 transition-colors hover:text-mango">Back to sign in</Link>
    </form>
  );
}

export default function RecoverPage() {
  const state = useRedirectIfSignedIn("login");
  if (state.loading || state.session || !state.hasAdmin) return <PageState label="Opening Body Temple Gym…" />;
  return (
    <AuthShell
      blurb="Locked out? Use the recovery code you saved when the account was created to set a new password."
      formTitle="Reset your password"
      formBlurb="Enter your email, your recovery code and a new password."
      footer="Lost the recovery code too? Restore a backup of the database, or contact whoever set up the app."
    >
      <RecoverForm />
    </AuthShell>
  );
}
