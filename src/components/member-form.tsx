"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Banknote, Smartphone, CreditCard, MoreHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { playClink, playChime } from "@/lib/sounds";
import { cn } from "@/lib/utils";
import type { Member, MembershipPlan, PaymentMethod } from "@/types/database";
import { addMonths, format } from "date-fns";

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "upi", label: "UPI", icon: Smartphone },
  { value: "card", label: "Card", icon: CreditCard },
  { value: "other", label: "Other", icon: MoreHorizontal },
];

export default function MemberForm({
  plans,
  existingMember,
}: {
  plans: MembershipPlan[];
  existingMember?: Member;
}) {
  const router = useRouter();
  const isEdit = Boolean(existingMember);

  const [name, setName] = useState(existingMember?.name ?? "");
  const [age, setAge] = useState(existingMember?.age?.toString() ?? "");
  const [email, setEmail] = useState(existingMember?.email ?? "");
  const [phone, setPhone] = useState(existingMember?.phone ?? "");
  const [planId, setPlanId] = useState<string>(
    existingMember?.plan_id?.toString() ?? (plans[0]?.id.toString() ?? "")
  );
  const [startDate, setStartDate] = useState(
    existingMember?.start_date ?? format(new Date(), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState(existingMember?.end_date ?? "");
  const [amountDue, setAmountDue] = useState(
    existingMember?.amount_due?.toString() ?? ""
  );
  // Only used when adding a new member — the initial payment collected
  // right now. Edit never touches payments; see the note above the form.
  const [initialPayment, setInitialPayment] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState(existingMember?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handlePlanChange(newPlanId: string) {
    setPlanId(newPlanId);
    const plan = plans.find((p) => p.id.toString() === newPlanId);
    if (plan && startDate) {
      setEndDate(
        format(addMonths(new Date(startDate), plan.duration_months), "yyyy-MM-dd")
      );
      if (!isEdit) {
        setAmountDue(plan.fee_amount.toString());
        setInitialPayment(plan.fee_amount.toString());
      }
    }
  }

  function handleStartDateChange(newStart: string) {
    setStartDate(newStart);
    const plan = plans.find((p) => p.id.toString() === planId);
    if (plan && newStart) {
      setEndDate(format(addMonths(new Date(newStart), plan.duration_months), "yyyy-MM-dd"));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const plan = plans.find((p) => p.id.toString() === planId);
    const dueAmount = amountDue ? parseFloat(amountDue) : 0;

    if (isEdit) {
      // Edit only ever corrects details and the agreed due amount — it
      // never touches fees_paid or logs a payment/renewal, so editing a
      // phone number can never fabricate a transaction record.
      const { error: dbError } = await supabase
        .from("members")
        .update({
          name: name.trim(),
          age: age ? parseInt(age, 10) : null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          plan_id: planId ? parseInt(planId, 10) : null,
          plan_name: plan?.name ?? null,
          start_date: startDate,
          end_date: endDate || null,
          amount_due: dueAmount,
          notes: notes.trim() || null,
        })
        .eq("id", existingMember!.id);

      setLoading(false);
      if (dbError) {
        setError(dbError.message);
        return;
      }
      playChime();
      router.push("/dashboard/members");
      router.refresh();
      return;
    }

    // Adding a new member: create the member, their first term (renewal),
    // and — if anything was paid right now — the payment transaction for
    // it, all tied together.
    const paidNow = initialPayment ? parseFloat(initialPayment) : 0;

    const { data: insertedMember, error: memberError } = await supabase
      .from("members")
      .insert({
        name: name.trim(),
        age: age ? parseInt(age, 10) : null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        plan_id: planId ? parseInt(planId, 10) : null,
        plan_name: plan?.name ?? null,
        start_date: startDate,
        end_date: endDate || null,
        fees_paid: paidNow,
        amount_due: dueAmount,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (memberError || !insertedMember) {
      setLoading(false);
      setError(memberError?.message ?? "Couldn't create member.");
      return;
    }

    const { data: insertedRenewal, error: renewalError } = await supabase
      .from("renewals")
      .insert({
        member_id: insertedMember.id,
        plan_id: planId ? parseInt(planId, 10) : null,
        plan_name: plan?.name ?? null,
        amount: paidNow,
        amount_due: dueAmount,
        start_date: startDate,
        end_date: endDate || null,
      })
      .select("id")
      .single();

    if (renewalError) {
      console.error("Failed to log initial term:", renewalError.message);
    } else if (paidNow > 0 && insertedRenewal) {
      const { error: paymentError } = await supabase.from("payments").insert({
        member_id: insertedMember.id,
        renewal_id: insertedRenewal.id,
        amount: paidNow,
        method,
      });
      if (paymentError) {
        console.error("Failed to log initial payment:", paymentError.message);
      }
    }

    setLoading(false);
    playClink();
    router.push("/dashboard/members");
    router.refresh();
  }

  const outstanding = isEdit
    ? (existingMember?.amount_due ?? 0) - (existingMember?.fees_paid ?? 0)
    : 0;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Full name" required>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Paras Bhonsle"
            className={inputClass}
          />
        </Field>
        <Field label="Age">
          <input
            type="number"
            min={10}
            max={100}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="28"
            className={inputClass}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="paras@example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            className={inputClass}
          />
        </Field>
        <Field label="Membership plan">
          <select
            value={planId}
            onChange={(e) => handlePlanChange(e.target.value)}
            className={inputClass}
          >
            <option value="">No plan selected</option>
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
            placeholder="1500"
            className={inputClass}
          />
        </Field>
        <Field label="Start date">
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="End date">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {isEdit ? (
        outstanding > 0 && (
          <p className="border-l-4 border-alert bg-alert/10 px-4 py-3 font-body text-sm text-alert">
            ₹{outstanding.toFixed(0)} still outstanding on this term. Use
            &quot;Record payment&quot; on their profile to log more paid —
            editing here only corrects the amount due, not payments.
          </p>
        )
      ) : (
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
                value={initialPayment}
                onChange={(e) => setInitialPayment(e.target.value)}
                placeholder="1500"
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
          {initialPayment && amountDue && parseFloat(initialPayment) < parseFloat(amountDue) && (
            <p className="font-body text-xs text-paper/40">
              ₹{(parseFloat(amountDue) - parseFloat(initialPayment)).toFixed(0)}{" "}
              will be left outstanding — you can log the rest later from
              their profile.
            </p>
          )}
        </div>
      )}

      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Injury history, goals, preferences…"
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
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Save className="h-5 w-5" />
          )}
          {isEdit ? "Save changes" : "Add member"}
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-sm font-medium text-paper/75">
        {label}
        {required && <span className="text-mango"> *</span>}
      </label>
      {children}
    </div>
  );
}
