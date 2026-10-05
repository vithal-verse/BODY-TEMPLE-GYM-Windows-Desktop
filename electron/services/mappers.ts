import { fromPaise } from "@shared/money";
import type { Attendance, AttendanceWithMember, Member, MembershipPlan, Payment, PaymentWithMember, Renewal } from "@shared/types";

export const MEMBER_COLS =
  "id, name, age, email, phone, plan_id, plan_name, start_date, end_date, fees_paid_paise, amount_due_paise, status, paused_at, notes, created_at, updated_at";

export type MemberRow = {
  id: string; name: string; age: number | null; email: string | null; phone: string | null;
  plan_id: number | null; plan_name: string | null; start_date: string; end_date: string | null;
  fees_paid_paise: number; amount_due_paise: number; status: Member["status"]; paused_at: string | null;
  notes: string | null; created_at: string; updated_at: string;
};
export const toMember = (r: MemberRow): Member => ({
  id: r.id, name: r.name, age: r.age, email: r.email, phone: r.phone, plan_id: r.plan_id, plan_name: r.plan_name,
  start_date: r.start_date, end_date: r.end_date, fees_paid: fromPaise(r.fees_paid_paise),
  amount_due: fromPaise(r.amount_due_paise), status: r.status, paused_at: r.paused_at, notes: r.notes,
  created_at: r.created_at, updated_at: r.updated_at,
});

export type PlanRow = { id: number; name: string; duration_months: number; fee_paise: number; created_at: string };
export const toPlan = (r: PlanRow): MembershipPlan => ({
  id: r.id, name: r.name, duration_months: r.duration_months, fee_amount: fromPaise(r.fee_paise), created_at: r.created_at,
});

export type RenewalRow = {
  id: string; member_id: string; plan_id: number | null; plan_name: string | null; amount_paise: number;
  amount_due_paise: number; start_date: string; end_date: string | null; created_at: string;
};
export const toRenewal = (r: RenewalRow): Renewal => ({
  id: r.id, member_id: r.member_id, plan_id: r.plan_id, plan_name: r.plan_name, amount: fromPaise(r.amount_paise),
  amount_due: fromPaise(r.amount_due_paise), start_date: r.start_date, end_date: r.end_date, created_at: r.created_at,
});

export type PaymentRow = {
  id: string; member_id: string; renewal_id: string; amount_paise: number; method: Payment["method"];
  paid_at: string; notes: string | null;
};
export const toPayment = (r: PaymentRow): Payment => ({
  id: r.id, member_id: r.member_id, renewal_id: r.renewal_id, amount: fromPaise(r.amount_paise),
  method: r.method, paid_at: r.paid_at, notes: r.notes,
});

export type AttendanceRow = {
  id: string; member_id: string; checked_in_at: string; checked_out_at: string | null; duration_minutes: number | null;
};
export const toAttendance = (r: AttendanceRow): Attendance => ({ ...r });

// Joined shapes: attendance/payment columns are aliased so `m.*` can ride along unprefixed.
export const SESSION_JOIN_SELECT = "a.id AS a_id, a.checked_in_at, a.checked_out_at, a.duration_minutes, m.*";
export type SessionJoinRow = MemberRow & {
  a_id: string; checked_in_at: string; checked_out_at: string | null; duration_minutes: number | null;
};
export const toSessionWithMember = (r: SessionJoinRow): AttendanceWithMember => ({
  member: toMember(r),
  session: {
    id: r.a_id, member_id: r.id, checked_in_at: r.checked_in_at,
    checked_out_at: r.checked_out_at, duration_minutes: r.duration_minutes,
  },
});

export const PAYMENT_JOIN_SELECT = "p.id AS p_id, p.renewal_id, p.amount_paise, p.method, p.paid_at, p.notes AS p_notes, m.*";
export type PaymentJoinRow = MemberRow & {
  p_id: string; renewal_id: string; amount_paise: number; method: Payment["method"]; paid_at: string; p_notes: string | null;
};
export const toPaymentWithMember = (r: PaymentJoinRow): PaymentWithMember => ({
  member: toMember(r),
  payment: {
    id: r.p_id, member_id: r.id, renewal_id: r.renewal_id, amount: fromPaise(r.amount_paise),
    method: r.method, paid_at: r.paid_at, notes: r.p_notes,
  },
});
