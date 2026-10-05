import { AppError } from "@shared/errors";
import { toPaise } from "@shared/money";
import { computeStatus } from "@shared/status";
import type {
  Member, MemberCreateInput, MemberListQuery, MemberStatus, MemberUpdateInput, Page, Payment,
  RecordPaymentInput, Renewal, RenewInput,
} from "@shared/types";
import { likeContains, runInTransaction } from "../database/connection";
import type { DatabaseManager } from "../database/manager";
import { MEMBER_COLS, type MemberRow, type PaymentRow, type RenewalRow, toMember, toPayment, toRenewal } from "./mappers";
import { addDaysStr, addMonthsStr, clamp, diffDays, newId, systemClock, toLocalDateStr, type Clock } from "./util";

type PlanLookup = { id: number; name: string; duration_months: number; fee_paise: number };

export type ExternalPatch = Partial<{
  name: string; age: number | null; email: string | null; phone: string | null; plan_name: string | null;
  start_date: string; end_date: string | null; fees_paid: number; status: MemberStatus;
}>;

export class MembersService {
  constructor(
    private readonly mgr: DatabaseManager,
    private readonly clock: Clock = systemClock,
    private readonly onChange: () => void = () => {}
  ) {}

  private get db() {
    return this.mgr.db;
  }
  private today() {
    return toLocalDateStr(this.clock());
  }
  private nowIso() {
    return this.clock().toISOString();
  }

  /**
   * Keeps `status` truthful as time passes. (In Postgres the status trigger only fired when a row
   * was written, so lapsed members stayed "active" until edited; here it runs on every read path.)
   */
  refreshStatuses(): number {
    const today = this.today();
    const a = this.db
      .prepare("UPDATE members SET status = 'expired' WHERE status = 'active' AND end_date IS NOT NULL AND end_date < ?")
      .run(today).changes;
    const b = this.db
      .prepare("UPDATE members SET status = 'active' WHERE status = 'expired' AND (end_date IS NULL OR end_date >= ?)")
      .run(today).changes;
    if (a + b > 0) this.onChange();
    return a + b;
  }

  private row(id: string): MemberRow | undefined {
    return this.db.prepare(`SELECT ${MEMBER_COLS} FROM members WHERE id = ?`).get(id) as MemberRow | undefined;
  }
  private mustRow(id: string): MemberRow {
    const r = this.row(id);
    if (!r) throw new AppError("NOT_FOUND", "That member no longer exists.");
    return r;
  }
  private mustGet(id: string): Member {
    return toMember(this.mustRow(id));
  }
  private planFor(planId: number | null | undefined): PlanLookup | null {
    if (planId === null || planId === undefined) return null;
    const p = this.db.prepare("SELECT id, name, duration_months, fee_paise FROM membership_plans WHERE id = ?").get(planId) as PlanLookup | undefined;
    if (!p) throw new AppError("VALIDATION", "The selected plan no longer exists. Pick another plan.");
    return p;
  }

  // ---- reads --------------------------------------------------------------
  list(q: MemberListQuery = {}): Page<Member> {
    this.refreshStatuses();
    const pageSize = clamp(Math.trunc(q.pageSize ?? 10), 1, 500);
    const page = Math.max(1, Math.trunc(q.page ?? 1));
    const today = this.today();
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    const term = q.query?.trim();
    if (term) {
      where.push("(ulower(name) LIKE @q ESCAPE '\\' OR ulower(email) LIKE @q ESCAPE '\\' OR ulower(phone) LIKE @q ESCAPE '\\')");
      params.q = likeContains(term);
    }
    const status = q.status ?? "all";
    if (status === "expiring") {
      where.push("status = 'active' AND end_date IS NOT NULL AND end_date >= @today AND end_date <= @cutoff");
      params.today = today;
      params.cutoff = addDaysStr(today, 7);
    } else if (status !== "all") {
      where.push("status = @status");
      params.status = status;
    }
    const key = q.sortKey ?? "name";
    const col = { name: "ulower(name)", start_date: "start_date", end_date: "COALESCE(end_date, '')", fees_paid: "fees_paid_paise", created_at: "created_at" }[key];
    if (!col) throw new AppError("VALIDATION", "Unknown sort column.");
    const dir = (q.sortDir ?? (key === "created_at" ? "desc" : "asc")) === "desc" ? "DESC" : "ASC";
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (this.db.prepare(`SELECT COUNT(*) c FROM members ${whereSql}`).get(params) as { c: number }).c;
    const rows = this.db
      .prepare(`SELECT ${MEMBER_COLS} FROM members ${whereSql} ORDER BY ${col} ${dir}, id ASC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as MemberRow[];
    return { rows: rows.map(toMember), total, page, pageSize };
  }

  get(id: string): Member | null {
    this.refreshStatuses();
    const r = this.row(id);
    return r ? toMember(r) : null;
  }

  /** Check-in lookup: name / email / phone, newest members first (same order as the web app). */
  search(query: string, limit = 8): Member[] {
    const term = query.trim();
    if (!term) return [];
    this.refreshStatuses();
    const rows = this.db
      .prepare(
        `SELECT ${MEMBER_COLS} FROM members
         WHERE ulower(name) LIKE @q ESCAPE '\\' OR ulower(email) LIKE @q ESCAPE '\\' OR ulower(phone) LIKE @q ESCAPE '\\'
         ORDER BY created_at DESC, id ASC LIMIT @limit`
      )
      .all({ q: likeContains(term), limit: clamp(Math.trunc(limit), 1, 50) }) as MemberRow[];
    return rows.map(toMember);
  }

  // ---- writes -------------------------------------------------------------
  create(input: MemberCreateInput): Member {
    const name = input.name.trim();
    if (!name) throw new AppError("VALIDATION", "Name is required.");
    const id = runInTransaction(this.db, () => {
      const plan = this.planFor(input.plan_id);
      const start = input.start_date;
      const end = input.end_date === undefined ? (plan ? addMonthsStr(start, plan.duration_months) : null) : input.end_date;
      const due = toPaise(input.amount_due ?? 0);
      const paid = toPaise(input.initial_payment ?? 0);
      const now = this.nowIso();
      const memberId = newId();
      this.db
        .prepare(
          `INSERT INTO members (id, name, age, email, phone, plan_id, plan_name, start_date, end_date,
             fees_paid_paise, amount_due_paise, status, notes, created_at, updated_at)
           VALUES (@id, @name, @age, @email, @phone, @plan_id, @plan_name, @start, @end, @paid, @due, @status, @notes, @now, @now)`
        )
        .run({
          id: memberId, name, age: input.age ?? null, email: input.email?.trim() || null, phone: input.phone?.trim() || null,
          plan_id: plan?.id ?? null, plan_name: plan?.name ?? null, start, end, paid, due,
          status: computeStatus("active", end, this.today()), notes: input.notes?.trim() || null, now,
        });
      // Every membership gets a term record (the web app created one right after the member row).
      const renewalId = this.insertRenewal(memberId, plan, paid, due, start, end, now);
      if (paid > 0) this.insertPayment(memberId, renewalId, paid, input.payment_method ?? "cash", now);
      return memberId;
    });
    this.onChange();
    return this.mustGet(id);
  }

  update(id: string, patch: MemberUpdateInput): Member {
    const name = patch.name.trim();
    if (!name) throw new AppError("VALIDATION", "Name is required.");
    runInTransaction(this.db, () => {
      const existing = this.mustRow(id);
      const plan = this.planFor(patch.plan_id);
      const end = patch.end_date ?? null;
      // Edit corrects details only: it never touches fees_paid or the term history.
      this.db
        .prepare(
          `UPDATE members SET name=@name, age=@age, email=@email, phone=@phone, plan_id=@plan_id, plan_name=@plan_name,
             start_date=@start, end_date=@end, amount_due_paise=@due, notes=@notes, status=@status WHERE id=@id`
        )
        .run({
          id, name, age: patch.age ?? null, email: patch.email?.trim() || null, phone: patch.phone?.trim() || null,
          plan_id: plan?.id ?? null, plan_name: plan?.name ?? null, start: patch.start_date, end,
          due: patch.amount_due === undefined ? existing.amount_due_paise : toPaise(patch.amount_due),
          notes: patch.notes?.trim() || null, status: computeStatus(existing.status, end, this.today()),
        });
    });
    this.onChange();
    return this.mustGet(id);
  }

  remove(id: string): void {
    const info = this.db.prepare("DELETE FROM members WHERE id = ?").run(id); // cascades to attendance/renewals/payments
    if (info.changes === 0) throw new AppError("NOT_FOUND", "That member no longer exists.");
    this.onChange();
  }

  pause(id: string): Member {
    this.refreshStatuses();
    runInTransaction(this.db, () => {
      const row = this.mustRow(id);
      if (row.status !== "active") throw new AppError("VALIDATION", "Only active memberships can be paused.");
      this.db.prepare("UPDATE members SET status = 'paused', paused_at = ? WHERE id = ?").run(this.today(), id);
    });
    this.onChange();
    return this.mustGet(id);
  }

  /** Resuming pushes the end date out by the number of calendar days the membership was paused. */
  resume(id: string): Member {
    runInTransaction(this.db, () => {
      const row = this.mustRow(id);
      if (row.status !== "paused") throw new AppError("VALIDATION", "This membership isn't paused.");
      const today = this.today();
      const days = row.paused_at ? Math.max(0, diffDays(row.paused_at, today)) : 0;
      const end = row.end_date && days > 0 ? addDaysStr(row.end_date, days) : row.end_date;
      this.db
        .prepare("UPDATE members SET status = ?, end_date = ?, paused_at = NULL WHERE id = ?")
        .run(computeStatus("active", end, today), end, id);
    });
    this.onChange();
    return this.mustGet(id);
  }

  /** Starts a new term: new renewal row (+ payment) and the member row moves to it, atomically. */
  renew(id: string, input: RenewInput): Member {
    runInTransaction(this.db, () => {
      this.mustRow(id);
      const plan = this.planFor(input.plan_id);
      const start = input.start_date;
      const end = input.end_date === undefined ? (plan ? addMonthsStr(start, plan.duration_months) : null) : input.end_date;
      const due = input.amount_due === undefined ? (plan?.fee_paise ?? 0) : toPaise(input.amount_due);
      const paid = toPaise(input.paid_now ?? 0);
      const now = this.nowIso();
      const renewalId = this.insertRenewal(id, plan, paid, due, start, end, now);
      if (paid > 0) this.insertPayment(id, renewalId, paid, input.method ?? "cash", now);
      this.db
        .prepare(
          `UPDATE members SET plan_id=@plan_id, plan_name=@plan_name, fees_paid_paise=@paid, amount_due_paise=@due,
             start_date=@start, end_date=@end, status=@status, paused_at=NULL WHERE id=@id`
        )
        .run({
          id, plan_id: plan?.id ?? null, plan_name: plan?.name ?? null, paid, due, start, end,
          status: computeStatus("active", end, this.today()),
        });
    });
    this.onChange();
    return this.mustGet(id);
  }

  recordPayment(id: string, input: RecordPaymentInput): Member {
    const amount = toPaise(input.amount);
    if (!(amount > 0)) throw new AppError("VALIDATION", "Enter an amount greater than zero.");
    runInTransaction(this.db, () => {
      this.mustRow(id);
      const renewal = this.db
        .prepare("SELECT id FROM renewals WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .get(id) as { id: string } | undefined;
      if (!renewal) {
        throw new AppError("CONFLICT", "This member has no membership term on record yet. Use Renew to start their first term.");
      }
      this.insertPayment(id, renewal.id, amount, input.method, this.nowIso(), input.notes?.trim() || null);
      this.db.prepare("UPDATE members SET fees_paid_paise = fees_paid_paise + ? WHERE id = ?").run(amount, id);
      this.db.prepare("UPDATE renewals SET amount_paise = amount_paise + ? WHERE id = ?").run(amount, renewal.id);
    });
    this.onChange();
    return this.mustGet(id);
  }

  /** Applies edits that came from the Google Sheet. Mirrors the web app: only the member row changes. */
  applyExternalPatch(id: string, patch: ExternalPatch): Member {
    runInTransaction(this.db, () => {
      const row = this.mustRow(id);
      const end = patch.end_date === undefined ? row.end_date : patch.end_date;
      this.db
        .prepare(
          `UPDATE members SET name=@name, age=@age, email=@email, phone=@phone, plan_name=@plan_name,
             start_date=@start, end_date=@end, fees_paid_paise=@paid, status=@status WHERE id=@id`
        )
        .run({
          id, name: patch.name ?? row.name, age: patch.age === undefined ? row.age : patch.age,
          email: patch.email === undefined ? row.email : patch.email, phone: patch.phone === undefined ? row.phone : patch.phone,
          plan_name: patch.plan_name === undefined ? row.plan_name : patch.plan_name,
          start: patch.start_date ?? row.start_date, end,
          paid: patch.fees_paid === undefined ? row.fees_paid_paise : toPaise(patch.fees_paid),
          status: computeStatus(patch.status ?? row.status, end, this.today()),
        });
    });
    return this.mustGet(id);
  }

  // ---- history ------------------------------------------------------------
  renewals(memberId: string): Renewal[] {
    const rows = this.db
      .prepare("SELECT * FROM renewals WHERE member_id = ? ORDER BY start_date DESC, created_at DESC, rowid DESC")
      .all(memberId) as RenewalRow[];
    return rows.map(toRenewal);
  }
  currentRenewal(memberId: string): Renewal | null {
    const r = this.db
      .prepare("SELECT * FROM renewals WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(memberId) as RenewalRow | undefined;
    return r ? toRenewal(r) : null;
  }
  payments(memberId: string): Payment[] {
    const rows = this.db.prepare("SELECT * FROM payments WHERE member_id = ? ORDER BY paid_at DESC, rowid DESC").all(memberId) as PaymentRow[];
    return rows.map(toPayment);
  }

  // ---- internals ----------------------------------------------------------
  private insertRenewal(memberId: string, plan: PlanLookup | null, paid: number, due: number, start: string, end: string | null, now: string) {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO renewals (id, member_id, plan_id, plan_name, amount_paise, amount_due_paise, start_date, end_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, memberId, plan?.id ?? null, plan?.name ?? null, paid, due, start, end, now);
    return id;
  }
  private insertPayment(memberId: string, renewalId: string, amount: number, method: string, paidAt: string, notes: string | null = null) {
    this.db
      .prepare("INSERT INTO payments (id, member_id, renewal_id, amount_paise, method, paid_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId(), memberId, renewalId, amount, method, paidAt, notes);
  }
}
