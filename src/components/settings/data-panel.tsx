"use client";

import { useState } from "react";
import { Database, Download, FolderOpen, RotateCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import type { BackupKind, BackupSettings } from "@/types/database";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { useDialog } from "@/components/dialog-provider";
import { useSession } from "@/components/session-provider";
import { PageState } from "@/components/page-state";
import { Card, Field, formatBytes, GhostButton, NoteView, PrimaryButton, type Note } from "@/components/ui";

const KIND_LABEL: Record<BackupKind, string> = {
  manual: "Manual", auto: "Automatic", "pre-restore": "Before a restore", "pre-migration": "Before an update",
  "pre-import": "Before an import", exported: "Exported",
};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function DataPanel() {
  const dialog = useDialog();
  const { state } = useSession();
  const isOwner = state.session?.role === "owner";
  const info = useAsync(() => api.system.info(), []);
  const list = useAsync(() => api.backup.list(), []);
  const settings = useAsync(() => api.backup.getSettings(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [edited, setEdited] = useState<BackupSettings | null>(null);

  const current = edited ?? settings.data ?? null;

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setNote(null);
    try {
      const text = await fn();
      if (text) setNote({ kind: "ok", text });
    } catch (e) {
      setNote({ kind: "err", text: errorMessage(e) });
    } finally {
      setBusy(null);
      list.reload();
      info.reload();
    }
  }

  if (!info.data || !list.data || !current) return <PageState error={info.error ?? list.error ?? settings.error} />;
  const i = info.data;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Your data" subtitle="Everything is stored on this computer and works with no internet connection.">
        <dl className="grid gap-x-8 gap-y-3 font-body text-sm sm:grid-cols-2">
          <div><dt className="text-paper/40">Database file</dt><dd className="break-all text-paper/80">{i.dbPath}</dd></div>
          <div><dt className="text-paper/40">Size</dt><dd className="text-paper/80">{formatBytes(i.dbSizeBytes)} · schema v{i.schemaVersion}</dd></div>
          <div><dt className="text-paper/40">Backups folder</dt><dd className="break-all text-paper/80">{i.backupDir}</dd></div>
          <div>
            <dt className="text-paper/40">Last integrity check</dt>
            <dd className={i.lastIntegrityCheck && !i.lastIntegrityCheck.ok ? "text-alert" : "text-paper/80"}>
              {i.lastIntegrityCheck ? `${i.lastIntegrityCheck.ok ? "Passed" : "Problems found"} · ${when(i.lastIntegrityCheck.at)}` : "Not run yet"}
            </dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-3">
          <GhostButton busy={busy === "integrity"} onClick={() => void run("integrity", async () => {
            const r = await api.backup.checkIntegrity();
            if (!r.ok) throw new Error(`Problems found: ${r.message}`);
            return "Database integrity check passed.";
          })}><ShieldCheck className="h-4 w-4" /> Check integrity</GhostButton>
          <GhostButton onClick={() => void api.system.openDataFolder().catch(() => undefined)}><FolderOpen className="h-4 w-4" /> Open data folder</GhostButton>
          <GhostButton onClick={() => void api.system.openLogs().catch(() => undefined)}><FolderOpen className="h-4 w-4" /> Open log folder</GhostButton>
        </div>
      </Card>

      <Card title="Backup & restore" subtitle="Backups are verified copies of the whole database. The app also makes one automatically, and always saves a safety copy before a restore, import or update.">
        <div className="flex flex-wrap gap-3">
          <PrimaryButton busy={busy === "backup"} onClick={() => void run("backup", async () => `Backup saved: ${(await api.backup.create()).fileName}`)}>
            <Database className="h-4 w-4" /> Backup Database
          </PrimaryButton>
          <GhostButton busy={busy === "export"} onClick={() => void run("export", async () => {
            const r = await api.backup.exportTo();
            return r.done ? `Exported to ${r.path}` : undefined;
          })}><Download className="h-4 w-4" /> Export a copy…</GhostButton>
          <GhostButton danger disabled={!isOwner} title={isOwner ? undefined : "Only the owner account can restore"} busy={busy === "restore-file"}
            onClick={() => void run("restore-file", async () => (await api.backup.restoreFromFile()).message)}>
            <Upload className="h-4 w-4" /> Restore Database…
          </GhostButton>
        </div>
        <div className="mt-5"><NoteView note={note} /></div>

        <h4 className="mb-2 mt-6 font-body text-sm font-semibold text-paper/70">Backups on this PC ({list.data.length})</h4>
        {list.data.length === 0 ? (
          <p className="font-body text-sm text-paper/40">No backups yet. Press “Backup Database” to make the first one.</p>
        ) : (
          <div className="overflow-x-auto border-2 border-ink-line">
            <table className="w-full min-w-[620px] border-collapse">
              <tbody>
                {list.data.map((b) => (
                  <tr key={b.fileName} className="border-b border-ink-line last:border-b-0">
                    <td className="px-4 py-3 font-body text-sm text-paper">{when(b.createdAt)}<span className="ml-2 text-xs text-paper/40">{KIND_LABEL[b.kind]}</span></td>
                    <td className="px-4 py-3 font-body text-xs text-paper/50">{formatBytes(b.sizeBytes)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <GhostButton busy={busy === `v:${b.fileName}`} onClick={() => void run(`v:${b.fileName}`, async () => {
                          const v = await api.backup.verify({ fileName: b.fileName });
                          if (!v.ok) throw new Error(v.message);
                          return v.message;
                        })}><ShieldCheck className="h-3.5 w-3.5" /> Verify</GhostButton>
                        <GhostButton disabled={!isOwner} busy={busy === `r:${b.fileName}`}
                          onClick={() => void run(`r:${b.fileName}`, async () => (await api.backup.restoreFromList({ fileName: b.fileName })).message)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Restore
                        </GhostButton>
                        <GhostButton danger disabled={!isOwner} onClick={async () => {
                          if (await dialog.confirm("Delete this backup file? This can't be undone.", { danger: true, confirmLabel: "Delete" })) {
                            await run(`d:${b.fileName}`, async () => { await api.backup.remove({ fileName: b.fileName }); });
                          }
                        }} aria-label="Delete backup"><Trash2 className="h-3.5 w-3.5" /></GhostButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Automatic backups" subtitle="Keep a second copy somewhere else (a USB drive or a OneDrive/Google Drive folder) in case this PC fails.">
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-3 font-body text-sm text-paper/80">
            <input type="checkbox" className="h-4 w-4 accent-[#FFC22C]" checked={current.autoEnabled} onChange={(e) => setEdited({ ...current, autoEnabled: e.target.checked })} />
            Back up automatically
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Back up every (hours)" type="number" min={1} max={720} value={current.intervalHours} onChange={(e) => setEdited({ ...current, intervalHours: parseInt(e.target.value, 10) || 1 })} />
            <Field label="Keep the newest (automatic backups)" type="number" min={1} max={365} value={current.keepAuto} onChange={(e) => setEdited({ ...current, keepAuto: parseInt(e.target.value, 10) || 1 })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GhostButton onClick={async () => {
              const dir = await api.backup.chooseSecondaryDir().catch(() => null);
              if (dir) setEdited({ ...current, secondaryDir: dir });
            }}><FolderOpen className="h-4 w-4" /> {current.secondaryDir ? "Change second folder…" : "Choose a second folder…"}</GhostButton>
            {current.secondaryDir && (
              <>
                <span className="break-all font-body text-xs text-paper/60">{current.secondaryDir}</span>
                <GhostButton onClick={() => setEdited({ ...current, secondaryDir: null })}>Clear</GhostButton>
              </>
            )}
          </div>
          <PrimaryButton className="self-start" disabled={!edited} onClick={() => void run("settings", async () => {
            await api.backup.saveSettings(current);
            setEdited(null);
            settings.reload();
            return "Backup settings saved.";
          })}>Save settings</PrimaryButton>
        </div>
      </Card>
    </div>
  );
}
