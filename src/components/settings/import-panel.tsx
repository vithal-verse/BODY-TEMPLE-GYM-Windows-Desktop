"use client";

import { useState } from "react";
import type { ImportMode, ImportSummary } from "@/types/database";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/components/session-provider";
import { Card, ErrorNote, Field, GhostButton, PasswordField, PrimaryButton } from "@/components/ui";

export default function ImportPanel() {
  const { state } = useSession();
  const isOwner = state.session?.role === "owner";
  const [mode, setMode] = useState<ImportMode>("merge");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);

  async function run(which: string, fn: () => Promise<ImportSummary | null>) {
    setBusy(which);
    setError(null);
    setResult(null);
    try {
      setResult(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!isOwner) return <Card title="Import">Only the owner account can import data.</Card>;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Bring over your existing Body Temple Gym data" subtitle="Copies members, plans, term history, payments and attendance from the old online version, keeping their original IDs, dates and amounts. A backup is taken first, and nothing is deleted unless you choose “Replace”.">
        <fieldset className="mb-2 flex flex-col gap-2 font-body text-sm text-paper/80">
          <legend className="mb-1 font-medium text-paper/70">If the app already has data…</legend>
          <label className="flex items-start gap-3"><input type="radio" name="mode" className="mt-1 accent-[#FFC22C]" checked={mode === "merge"} onChange={() => setMode("merge")} />
            <span><strong>Merge</strong> — add what&apos;s missing; anything already here is left exactly as it is.</span></label>
          <label className="flex items-start gap-3"><input type="radio" name="mode" className="mt-1 accent-[#FFC22C]" checked={mode === "replace"} onChange={() => setMode("replace")} />
            <span><strong>Replace</strong> — wipe members, plans, payments and attendance first, then import (asks for confirmation).</span></label>
        </fieldset>
      </Card>

      <Card title="Option 1 — from exported files" subtitle="In Supabase open each table (members, membership_plans, renewals, payments, attendance) and export it as CSV or JSON into one folder, then pick that folder.">
        <GhostButton busy={busy === "folder"} onClick={() => void run("folder", () => api.importer.fromFolder({ mode }))}>Choose folder…</GhostButton>
      </Card>

      <Card title="Option 2 — directly from Supabase" subtitle="Needs internet once. The key is used for this import only and is never saved. Use the service_role key from Project Settings → API.">
        <div className="flex flex-col gap-4">
          <Field label="Project URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcdxyz.supabase.co" autoComplete="off" />
          <PasswordField label="service_role key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          <PrimaryButton className="self-start" busy={busy === "supabase"} disabled={!url || !key}
            onClick={() => void run("supabase", async () => { const r = await api.importer.fromSupabase({ url, serviceKey: key, mode }); setKey(""); return r; })}>
            Import from Supabase
          </PrimaryButton>
        </div>
      </Card>

      <ErrorNote>{error}</ErrorNote>
      {result && (
        <Card title="Import finished">
          <p className="font-body text-sm text-paper/80">
            Added {result.members} members, {result.plans} plans, {result.renewals} terms, {result.payments} payments and {result.attendance} attendance records.
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-3 list-disc pl-5 font-body text-sm text-paper/60">
              {result.skipped.map((s) => <li key={`${s.table}|${s.reason}`}>{s.count} {s.table} skipped — {s.reason}</li>)}
            </ul>
          )}
          {result.warnings.map((w) => <p key={w} className="mt-3 font-body text-xs text-paper/50">{w}</p>)}
          {result.backupFile && <p className="mt-3 font-body text-xs text-paper/40">Safety backup taken first: {result.backupFile}</p>}
        </Card>
      )}
    </div>
  );
}
