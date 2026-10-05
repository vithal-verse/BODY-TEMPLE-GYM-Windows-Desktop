"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addMonths, addDays, format, isAfter, parseISO } from "date-fns";
import { Loader2, RotateCw, Banknote, Smartphone, CreditCard, MoreHorizontal } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useRefresh } from "@/components/session-provider";
import { playChime } from "@/lib/sounds";
import { formatDate, cn } from "@/lib/utils";
import type { Member, MembershipPlan, PaymentMethod } from "@/types/database";

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "upi", label: "UPI", icon: Smartphone },
  { value: "card", label: "Card", icon: CreditCard },
  { value: "other", label: "Other", icon: MoreHorizontal },
];

function computeDefaultStartDate(member: Member): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (member.end_date) {
    const currentEnd = parseISO(member.end_date);
    // Still active (or expires today) — start the new term the day after
    // it ends, so paid time never overlaps or gaps by mistake.
    if (member.status === "active" && !isAfter(today, currentEnd)) {
      return format(addDays(currentEnd, 1), "yyyy-MM-dd");
    }
  }
  // Already expired, or no prior end date on record — start today.
  return format(today, "yyyy-MM-dd");
}

export default function RenewForm({
  member,
  plans,
}: {
  member: Member;
  plans: MembershipPlan[];
}) {
  const router = useRouter();
  const refresh = useRefresh();
  const defaultPlanId =
    plans.find((p) => p.id === member.plan_id)?.id.toString() ??
    plans[0]?.id.toString() ??
    "";
  const defaultStart = computeDefaultStartDate(member);
  const defaultPlan = plans.find((p) => p.id.toString() === defaultPlanId);

  const [planId, setPlanId] = useState(defaultPlanId);
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(
    defaultPlan
      ? format(addMonths(parseISO(defaultStart), defaultPlan.duration_months), "yyyy-MM-dd")
      : ""
  );
  const [amountDue, setAmountDue] = useState(
    defaultPlan?.fee_amount.toString() ?? ""
  );
  const [payingNow, setPayingNow] = useState(
    defaultPlan?.fee_amount.toString() ?? ""
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handlePlanChange(newPlanId: string) {
    setPlanId(newPlanId);
    const plan = plans.find((p) => p.id.toString() === newPlanId);
    if (plan) {
      setEndDate(format(addMonths(parseISO(startDate), plan.duration_months), "yyyy-MM-dd"));
      setAmountDue(plan.fee_amount.toString());
      setPayingNow(plan.fee_amount.toString());
    }
  }

  function handleStartDateChange(newStart: string) {
    setStartDate(newStart);
    const plan = plans.find((p) => p.id.toString() === planId);
    if (plan && newStart) {
      setEndDate(format(addMonths(parseISO(newStart), plan.duration_months), "yyyy-MM-dd"));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // One atomic step in the main process: new term + payment + member update (clears any pause).
      await api.members.renew({
        id: member.id,
        input: {
          plan_id: planId ? parseInt(planId, 10) : null,
          start_date: startDate,
          end_date: endDate || null,
          amount_due: amountDue ? parseFloat(amountDue) : 0,
          paid_now: payingNow ? parseFloat(payingNow) : 0,
          method,
        },
      });
      playChime();
      refresh();
      router.push(`/dashboard/members/detail?id=${member.id}`);
    } catch (err) {
      setLoading(false);
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4 border-2 border-ink-line bg-ink px-4 py-3">
        <div>
          <p className="font-body text-xs uppercase tracking-wide text-paper/40">
            Current plan
          </p>
          <p className="font-body text-sm text-paper">
            {member.plan_name || "No plan on record"}
          </p>
        </div>
        <div>
          <p className="font-body text-xs uppercase tracking-wide text-paper/40">
            Current end date
          </p>
          <p className="font-body text-sm text-paper">
            {formatDate(member.end_date)}
          </p>
        </div>
        <div>
          <p className="font-body text-xs uppercase tracking-wide text-paper/40">
            Status
          </p>
          <p className="font-body text-sm capitalize text-paper">
            {member.status}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="New plan">
            <select
              value={planId}
              onChange={(e) => handlePlanChange(e.target.value)}
              className={inputClass}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₹{p.fee_amount} / {p.duration_months}mo
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount due (₹)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={amountDue}
              onChange={(e) => setAmountDue(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="New start date">
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => handleStartDateChange(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="New end date">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-4 border-2 border-ink-line bg-ink p-4">
          <p className="font-body text-xs font-semibold uppercase tracking-wide text-paper/40">
            Payment collected now
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Amount paid now (₹)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={payingNow}
                onChange={(e) => setPayingNow(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Payment method">
              <div className="grid grid-cols-4 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 border-2 py-2.5 font-body text-xs font-medium transition-colors",
                      method === m.value
                        ? "border-mango bg-mango/10 text-mango"
                        : "border-ink-line text-paper/50 hover:border-paper/30"
                    )}
                  >
                    <m.icon className="h-4 w-4" />
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          {payingNow && amountDue && parseFloat(payingNow) < parseFloat(amountDue) && (
            <p className="font-body text-xs text-paper/40">
              ₹{(parseFloat(amountDue) - parseFloat(payingNow)).toFixed(0)}{" "}
              will be left outstanding on this term.
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="border-l-4 border-alert bg-alert/10 px-4 py-3 font-body text-sm text-alert"
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-mango px-6 py-3 font-display text-lg tracking-wide text-ink transition-colors hover:bg-mango-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <RotateCw className="h-5 w-5" />
            )}
            Confirm renewal
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-3 font-body text-sm font-medium text-paper/50 transition-colors hover:text-paper"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  "w-full border-2 border-ink-line bg-ink px-4 py-2.5 font-body text-sm text-paper placeholder:text-paper/30 outline-none transition-colors focus:border-mango";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-sm font-medium text-paper/75">
        {label}
      </label>
      {children}
    </div>
  );
}
