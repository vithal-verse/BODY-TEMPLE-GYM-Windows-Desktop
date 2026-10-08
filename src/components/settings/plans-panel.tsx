"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { MembershipPlan } from "@/types/database";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { formatCurrency } from "@/lib/utils";
import { useDialog } from "@/components/dialog-provider";
import { useRefresh } from "@/components/session-provider";
import { PageState } from "@/components/page-state";
import { Card, ErrorNote, Field, GhostButton, PrimaryButton } from "@/components/ui";

const BLANK = { name: "", months: "1", fee: "" };

export default function PlansPanel() {
  const dialog = useDialog();
  const refresh = useRefresh();
  const { data: plans, error, reload } = useAsync(() => api.plans.list(), []);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(BLANK);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function start(p?: MembershipPlan) {
    setErr(null);
    setEditing(p ? p.id : "new");
    setForm(p ? { name: p.name, months: String(p.duration_months), fee: String(p.fee_amount) } : BLANK);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const patch = { name: form.name, duration_months: parseInt(form.months, 10), fee_amount: parseFloat(form.fee) };
      if (editing === "new") await api.plans.create(patch);
      else await api.plans.update({ id: editing as number, patch });
      setEditing(null);
      reload();
      refresh();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: MembershipPlan) {
    const ok = await dialog.confirm(
      `Delete the "${p.name}" plan? Members already on it keep their plan name and history; it just won't be offered for new sign-ups or renewals.`,
      { title: "Delete plan", confirmLabel: "Delete plan", danger: true }
    );
    if (!ok) return;
    try {
      await api.plans.remove({ id: p.id });
      reload();
      refresh();
    } catch (e) {
      await dialog.alert(errorMessage(e));
    }
  }

  if (!plans) return <PageState error={error} />;

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Membership plans"
        subtitle="These appear when adding or renewing a member and fill in the end date and fee automatically. Changing a plan's price never changes what existing members already owe."
      >
        <ul className="flex flex-col divide-y divide-ink-line border-2 border-ink-line">
          {plans.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="font-body text-sm font-medium text-paper">{p.name}</p>
                <p className="font-body text-xs text-paper/40">{p.duration_months} {p.duration_months === 1 ? "month" : "months"} · {formatCurrency(p.fee_amount)}</p>
              </div>
              <div className="flex gap-2">
                <GhostButton onClick={() => start(p)} aria-label={`Edit ${p.name}`}><Pencil className="h-3.5 w-3.5" /></GhostButton>
                <GhostButton danger onClick={() => void remove(p)} aria-label={`Delete ${p.name}`}><Trash2 className="h-3.5 w-3.5" /></GhostButton>
              </div>
            </li>
          ))}
          {plans.length === 0 && <li className="px-4 py-6 text-center font-body text-sm text-paper/40">No plans yet — add one below.</li>}
        </ul>
        {editing === null && (
          <GhostButton className="mt-4" onClick={() => start()}><Plus className="h-4 w-4" /> Add a plan</GhostButton>
        )}
      </Card>

      {editing !== null && (
        <Card title={editing === "new" ? "New plan" : "Edit plan"}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 6 Months" />
            <Field label="Duration (months)" type="number" min={1} max={60} value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} />
            <Field label="Fee (₹)" type="number" min={0} step="any" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <ErrorNote>{err}</ErrorNote>
            <div className="flex gap-3">
              <PrimaryButton busy={busy} onClick={() => void save()}>Save plan</PrimaryButton>
              <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
