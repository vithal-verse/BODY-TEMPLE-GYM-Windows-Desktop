import { createClient } from "@/lib/supabase/server";
import { getMembers } from "@/lib/members";
import type { Payment, Member } from "@/types/database";

export async function getPaymentHistory(memberId: string): Promise<Payment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("member_id", memberId)
    .order("paid_at", { ascending: false });

  if (error) {
    console.error("getPaymentHistory error:", error.message);
    return [];
  }
  return data ?? [];
}

export interface OutstandingSummary {
  totalOutstanding: number;
  membersWithBalance: (Member & { outstanding: number })[];
}

export async function getOutstandingSummary(): Promise<OutstandingSummary> {
  const members = await getMembers();

  const membersWithBalance = members
    .map((m) => ({ ...m, outstanding: m.amount_due - m.fees_paid }))
    .filter((m) => m.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);

  const totalOutstanding = membersWithBalance.reduce(
    (sum, m) => sum + m.outstanding,
    0
  );

  return { totalOutstanding, membersWithBalance };
}

/**
 * Every payment transaction, each with its member attached — the single
 * source of truth for revenue reporting. Deliberately reads from
 * `payments` (one row per actual transaction) rather than
 * `members.fees_paid` (a running total per member), since summing the
 * member-level snapshot would double count anyone who's paid more than
 * once and mis-date everything to their current term instead of when
 * each payment actually happened.
 */
export interface PaymentWithMember {
  payment: Payment;
  member: Member;
}

export async function getAllPaymentsWithMembers(): Promise<PaymentWithMember[]> {
  const supabase = await createClient();
  const [{ data: payments, error }, members] = await Promise.all([
    supabase.from("payments").select("*").order("paid_at", { ascending: false }),
    getMembers(),
  ]);

  if (error) {
    console.error("getAllPaymentsWithMembers error:", error.message);
    return [];
  }

  const membersById = new Map(members.map((m) => [m.id, m]));
  return (payments ?? [])
    .map((payment) => {
      const member = membersById.get(payment.member_id);
      return member ? { payment, member } : null;
    })
    .filter((entry): entry is PaymentWithMember => entry !== null);
}
