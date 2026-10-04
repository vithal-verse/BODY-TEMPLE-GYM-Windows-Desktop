"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Banknote, Smartphone, CreditCard, MoreHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { playChime } from "@/lib/sounds";
import { formatCurrency, cn } from "@/lib/utils";
import type { Member, Renewal, PaymentMethod } from "@/types/database";

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "upi", label: "UPI", icon: Smartphone },
  { value: "card", label: "Card", icon: CreditCard },
  { value: "other", label: "Other", icon: MoreHorizontal },
];

export default function RecordPaymentForm({
  member,
  currentRenewal,
}: {
  member: Member;
  currentRenewal: Renewal;
}) {
  const router = useRouter();
  const outstanding = Math.max(0, member.amount_due - member.fees_paid);

  const [amount, setAmount] = useState(
    outstanding > 0 ? outstanding.toString() : ""
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const paidAmount = parseFloat(amount);
    if (!paidAmount || paidAmount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { error: paymentError } = await supabase.from("payments").insert({
      member_id: member.id,
      renewal_id: currentRenewal.id,
      amount: paidAmount,
      method,
      notes: notes.trim() || null,
    });

    if (paymentError) {
      setLoading(false);
      setError(paymentError.message);
      return;
    }

    const newTotalPaid = member.fees_paid + paidAmount;

    const [{ error: memberError }, { error: renewalError }] = await Promise.all([
      supabase
        .from("members")
        .update({ fees_paid: newTotalPaid })
        .eq("id", member.id),
      supabase
        .from("renewals")
        .update({ amount: currentRenewal.amount + paidAmount })
        .eq("id", currentRenewal.id),
    ]);

    setLoading(false);

    if (memberError || renewalError) {
      setError((memberError ?? renewalError)!.message);
      return;
    }

    playChime();
    router.push(`/dashboard/members/${member.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4 border-2 border-ink-line bg-ink px-4 py-3">
        <div>
          <p className="font-body text-xs uppercase tracking-wide text-paper/40">Due</p>
          <p className="font-display text-lg text-paper">
            {formatCurrency(member.amount_due)}
          </p>
        </div>
        <div>
          <p className="font-body text-xs uppercase tracking-wide text-paper/40">Paid</p>
          <p className="font-display text-lg text-paper">
            {formatCurrency(member.fees_paid)}
          </p>
        </div>
        <div>
          <p className="font-body text-xs uppercase tracking-wide text-paper/40">
            Outstanding
          </p>
          <p
            className={cn(
              "font-display text-lg",
              outstanding > 0 ? "text-alert" : "text-good"
            )}
          >
            {formatCurrency(outstanding)}
          </p>
        </div>
      </div>

      <Field label="Amount received (₹)">
        <input
          type="number"
          min={0}
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
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

      <Field label="Note (optional)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paid remaining balance"
          className={inputClass}
        />
      </Field>

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
          {loading && <Loader2 className="h-5 w-5 animate-spin" />}
          Record payment
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
