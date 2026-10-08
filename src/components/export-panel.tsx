"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { useDialog } from "@/components/dialog-provider";
import { PageState } from "@/components/page-state";
import { formatDate, formatCurrency } from "@/lib/utils";

const HEADERS = [
  "Name",
  "Age",
  "Email",
  "Phone",
  "Plan",
  "Start date",
  "End date",
  "Amount due",
  "Fees paid",
  "Outstanding",
  "Status",
];

export default function ExportPanel() {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  // Only the first five rows are needed for the preview; the file itself is built by the main process.
  const { data, error } = useAsync(() => api.members.list({ pageSize: 5, sortKey: "created_at" }), []);
  if (!data) return <PageState error={error} />;
  const members = data.rows;
  const total = data.total;

  async function handleExport() {
    setBusy(true);
    setSavedTo(null);
    try {
      const r = await api.exports.members(); // opens the Windows "Save as" dialog
      if (r.done && r.path) setSavedTo(r.path);
    } catch (err) {
      await dialog.alert(`Couldn't export the member list: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-5 border-2 border-ink-line bg-ink-raised p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-mango text-mango">
            <FileSpreadsheet className="h-6 w-6" />
          </span>
          <div>
            <p className="font-display text-lg text-paper">
              {total} {total === 1 ? "member" : "members"}{" "}
              ready to export
            </p>
            <p className="font-body text-sm text-paper/40">
              Includes contact info, plan, dates, dues, payments, and status.
            </p>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={total === 0 || busy}
          className="flex w-full items-center justify-center gap-2 bg-mango px-6 py-3 font-display text-lg tracking-wide text-ink transition-colors hover:bg-mango-deep disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <Download className="h-5 w-5" />
          {busy ? "Saving…" : "Download CSV"}
        </button>
      </div>

      {savedTo && (
        <p role="status" className="border-l-4 border-good bg-good/10 px-4 py-3 font-body text-sm text-good">
          Saved to {savedTo}
        </p>
      )}

      {/* Preview */}
      {total > 0 && (
        <div className="overflow-x-auto border-2 border-ink-line">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink-line bg-ink-raised">
                {HEADERS.map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const outstanding = Math.max(0, m.amount_due - m.fees_paid);
                return (
                  <tr key={m.id} className="border-b border-ink-line last:border-b-0">
                    <td className="px-4 py-3 font-body text-sm text-paper">{m.name}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{m.age ?? "—"}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{m.email || "—"}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{m.phone || "—"}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{m.plan_name || "—"}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{formatDate(m.start_date)}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{formatDate(m.end_date)}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{formatCurrency(m.amount_due)}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{formatCurrency(m.fees_paid)}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{formatCurrency(outstanding)}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/60">{m.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > 5 && (
            <p className="border-t border-ink-line bg-ink-raised px-4 py-2 font-body text-xs text-paper/35">
              Showing 5 of {total} rows. The full list is included
              in the download.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
