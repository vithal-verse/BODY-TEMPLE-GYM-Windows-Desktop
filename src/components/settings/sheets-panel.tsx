"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { PageState } from "@/components/page-state";
import { Card, Field, GhostButton, NoteView, PrimaryButton, inputClass, labelClass, type Note } from "@/components/ui";

type Form = { sheet: string; email: string; key: string; auto: boolean };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN") : "never");

export default function SheetsPanel() {
  const cfg = useAsync(() => api.sheets.getConfig(), []);
  const [edited, setEdited] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const c = cfg.data;
  if (!c) return <PageState error={cfg.error} />;
  const form: Form = edited ?? { sheet: c.spreadsheetId, email: c.clientEmail, key: "", auto: c.autoSync };

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setNote(null);
    try {
      setNote({ kind: "ok", text: await fn() });
    } catch (e) {
      setNote({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
      cfg.reload();
    }
  }
  const save = () => run("save", async () => {
    await api.sheets.saveConfig({ spreadsheetId: form.sheet, clientEmail: form.email, privateKey: form.key || undefined, autoSync: form.auto });
    setEdited(null);
    return "Google Sheets settings saved.";
  });

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Google Sheets (optional)"
        subtitle="Keeps a live copy of your member list in a Google Sheet. The app never needs it: this computer's database is always the source of truth, and everything works the same offline."
      >
        <ol className="mb-6 list-decimal space-y-1 pl-5 font-body text-sm text-paper/55">
          <li>In Google Cloud, create a <em>service account</em>, enable the Google Sheets API, and download its JSON key.</li>
          <li>Create a Google Sheet and share it (as Editor) with the service account&apos;s email address.</li>
          <li>Paste the sheet&apos;s link and the key below, then press Test connection.</li>
        </ol>
        <div className="flex flex-col gap-4">
          <Field label="Spreadsheet link or ID" value={form.sheet} onChange={(e) => setEdited({ ...form, sheet: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" />
          <Field label="Service account email" value={form.email} onChange={(e) => setEdited({ ...form, email: e.target.value })} placeholder="sync@your-project.iam.gserviceaccount.com" />
          <div className="flex flex-col gap-2">
            <label htmlFor="sheets-key" className={labelClass}>Private key</label>
            <textarea id="sheets-key" rows={4} value={form.key} onChange={(e) => setEdited({ ...form, key: e.target.value })} spellCheck={false} autoComplete="off"
              placeholder={c.hasPrivateKey ? "A key is saved (encrypted by Windows). Leave blank to keep it, or paste a new one." : "Paste the whole downloaded JSON file here, or just the private_key value."}
              className={`${inputClass} font-mono text-xs`} />
          </div>
          <label className="flex items-center gap-3 font-body text-sm text-paper/80">
            <input type="checkbox" className="h-4 w-4 accent-[#FFC22C]" checked={form.auto} onChange={(e) => setEdited({ ...form, auto: e.target.checked })} />
            Update the sheet automatically a few seconds after any member changes
          </label>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton busy={busy === "save"} onClick={() => void save()}>Save</PrimaryButton>
            <GhostButton busy={busy === "test"} onClick={() => void run("test", async () => `Connected to “${(await api.sheets.test()).title}”.`)}>Test connection</GhostButton>
          </div>
        </div>
      </Card>

      <Card title="Sync now" subtitle="“Send” rewrites the Members tab from this computer. “Fetch edits” reads changes you made in the sheet (name, age, contact, plan name, dates, fees paid, status) — but never overwrites a member you changed in the app since the last send.">
        <div className="flex flex-wrap gap-3">
          <GhostButton busy={busy === "push"} onClick={() => void run("push", async () => `Sent ${(await api.sheets.push()).synced} members to the sheet.`)}>Send to sheet</GhostButton>
          <GhostButton busy={busy === "pull"} onClick={() => void run("pull", async () => {
            const r = await api.sheets.pull();
            return `Updated ${r.updatedMembers} member(s) (${r.fieldsChanged} field(s)). Skipped ${r.conflictsSkipped} changed in the app, ${r.invalidSkipped} invalid cell(s).`;
          })}>Fetch edits from sheet</GhostButton>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <NoteView note={note} />
          <p className="font-body text-xs text-paper/40">Last sent: {when(c.lastPushAt)} · Last fetched: {when(c.lastPullAt)}</p>
          {c.lastError && <p className="font-body text-xs text-alert">Last problem: {c.lastError}</p>}
        </div>
      </Card>
    </div>
  );
}
