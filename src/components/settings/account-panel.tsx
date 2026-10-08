"use client";

import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { passwordProblem } from "@shared/validation";
import type { AdminRole } from "@/types/database";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { useDialog } from "@/components/dialog-provider";
import { useSession } from "@/components/session-provider";
import { PageState } from "@/components/page-state";
import { Card, ErrorNote, Field, GhostButton, NoteView, PasswordField, PrimaryButton, RecoveryCodeNotice, inputClass, labelClass, type Note } from "@/components/ui";

function ChangePassword() {
  const { state } = useSession();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setNote(null);
    const problem = passwordProblem(next, state.session?.email);
    if (problem) return setNote({ kind: "err", text: problem });
    if (next !== again) return setNote({ kind: "err", text: "The two new passwords don't match." });
    setBusy(true);
    try {
      await api.auth.changePassword({ currentPassword: cur, newPassword: next });
      setCur(""); setNext(""); setAgain("");
      setNote({ kind: "ok", text: "Password changed." });
    } catch (err) {
      setNote({ kind: "err", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Change your password" subtitle={`Signed in as ${state.session?.email} (${state.session?.role}).`}>
      <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
        <PasswordField label="Current password" required value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        <PasswordField label="New password" required value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <PasswordField label="Confirm new password" required value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
        <NoteView note={note} />
        <PrimaryButton type="submit" busy={busy} className="self-start">Change password</PrimaryButton>
      </form>
    </Card>
  );
}

function Admins() {
  const dialog = useDialog();
  const { state } = useSession();
  const { data, error, reload } = useAsync(() => api.auth.listAdmins(), []);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "admin" as AdminRole });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const isOwner = state.session?.role === "owner";

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const problem = passwordProblem(form.password, form.email);
    if (problem) return setErr(problem);
    setBusy(true);
    try {
      const r = await api.auth.createAdmin({ full_name: form.name, email: form.email, password: form.password, role: form.role });
      setCode(r.recoveryCode);
      setForm({ name: "", email: "", password: "", role: "admin" });
      reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string, email: string) {
    if (!(await dialog.confirm(`Remove ${email}? They won't be able to sign in any more.`, { danger: true, confirmLabel: "Remove" }))) return;
    try {
      await api.auth.removeAdmin({ id });
      reload();
    } catch (e) {
      await dialog.alert(errorMessage(e));
    }
  }
  if (!data) return <PageState error={error} />;

  return (
    <Card title="Staff accounts" subtitle="Everyone listed can sign in. Only the owner can add or remove accounts.">
      <ul className="divide-y divide-ink-line border-2 border-ink-line">
        {data.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="font-body text-sm font-medium text-paper">{a.full_name || a.email} <span className="ml-2 text-xs uppercase tracking-wide text-mango">{a.role}</span></p>
              <p className="font-body text-xs text-paper/40">{a.email} · last sign-in {a.last_login_at ? new Date(a.last_login_at).toLocaleString("en-IN") : "never"}</p>
            </div>
            {isOwner && a.id !== state.session?.adminId && (
              <GhostButton danger onClick={() => void remove(a.id, a.email)} aria-label={`Remove ${a.email}`}><Trash2 className="h-3.5 w-3.5" /></GhostButton>
            )}
          </li>
        ))}
      </ul>

      {isOwner && !code && (
        <form onSubmit={add} className="mt-6 flex max-w-xl flex-col gap-4">
          <h4 className="font-display text-lg text-paper">Add someone</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <PasswordField label="Temporary password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            <div className="flex flex-col gap-2">
              <label htmlFor="role" className={labelClass}>Role</label>
              <select id="role" className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AdminRole })}>
                <option value="admin">Admin (front desk)</option>
                <option value="owner">Owner (can manage accounts, restore &amp; import)</option>
              </select>
            </div>
          </div>
          <ErrorNote>{err}</ErrorNote>
          <PrimaryButton type="submit" busy={busy} className="self-start">Add account</PrimaryButton>
        </form>
      )}
      {code && (
        <div className="mt-6 max-w-xl">
          <p className="mb-4 font-body text-sm text-paper/60">Account created. Give them their password and keep this recovery code with it — it&apos;s the only way to reset their password offline.</p>
          <RecoveryCodeNotice code={code} doneLabel="Done" onDone={() => setCode(null)} />
        </div>
      )}
    </Card>
  );
}

function About() {
  const { data } = useAsync(() => api.system.info(), []);
  if (!data) return null;
  return (
    <Card title="About this app">
      <p className="font-body text-sm text-paper/70">
        {data.name} {data.version} · Electron {data.electron} · {data.platform}
      </p>
      <p className="mt-1 break-all font-body text-xs text-paper/40">Data: {data.dataDir}</p>
    </Card>
  );
}

export default function AccountPanel() {
  return (
    <div className="flex flex-col gap-6">
      <ChangePassword />
      <Admins />
      <About />
    </div>
  );
}
