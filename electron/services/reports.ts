import { AppError } from "@shared/errors";
import { buildCsv, guardFormula } from "@shared/csv";
import { fromPaise } from "@shared/money";
import { revenueTrend, trendWindowStart } from "@shared/trends";
import type {
  DashboardStats, Member, PaymentMethod, RevenueQuery, RevenueReport, RevenueTrendGranularity, RevenueTrendPoint,
} from "@shared/types";
import { PAYMENT_METHOD_VALUES } from "@shared/types";
import { likeContains } from "../database/connection";
import type { DatabaseManager } from "../database/manager";
import {
  MEMBER_COLS, type MemberRow, PAYMENT_JOIN_SELECT, type PaymentJoinRow, SESSION_JOIN_SELECT, type SessionJoinRow,
  toMember, toPaymentWithMember, toSessionWithMember,
} from "./mappers";
import type { MembersService } from "./members";
import { addDaysStr, clamp, dayBoundsIso, newId, systemClock, toLocalDateStr, type Clock } from "./util";

const p2 = (n: number) => String(n).padStart(2, "0");

export class DashboardService {
  constructor(private readonly mgr: DatabaseManager, private readonly members: MembersService, private readonly clock: Clock = systemClock) {}
  private get db() {
    return this.mgr.db;
  }

  /** Same semantics as the web dashboard: revenue = Σ members.fees_paid, charted by the month each membership started. */
  stats(): DashboardStats {
    this.members.refreshStatuses();
    const now = this.clock();
    const today = toLocalDateStr(now);
    const c = this.db
      .prepare("SELECT COUNT(*) total, SUM(status = 'active') active, SUM(status = 'expired') expired, COALESCE(SUM(fees_paid_paise), 0) revenue FROM members")
      .get() as { total: number; active: number | null; expired: number | null; revenue: number };

    const expiring = this.db
      .prepare(`SELECT ${MEMBER_COLS} FROM members WHERE status = 'active' AND end_date IS NOT NULL AND end_date >= ? AND end_date <= ? ORDER BY end_date ASC, ulower(name) ASC`)
      .all(today, addDaysStr(today, 7)) as MemberRow[];

    const months: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${p2(d.getMonth() + 1)}`, label: d.toLocaleDateString("en-IN", { month: "short" }) });
    }
    const byMonth = new Map(
      (this.db
        .prepare("SELECT substr(start_date, 1, 7) ym, SUM(fees_paid_paise) s FROM members WHERE start_date >= ? GROUP BY ym")
        .all(`${months[0].key}-01`) as { ym: string; s: number }[]).map((r) => [r.ym, r.s])
    );

    const { startIso, endIso } = dayBoundsIso(today);
    const sessions = this.db
      .prepare(`SELECT ${SESSION_JOIN_SELECT} FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.checked_in_at >= ? AND a.checked_in_at < ? ORDER BY a.checked_in_at DESC, a.rowid DESC`)
      .all(startIso, endIso) as SessionJoinRow[];

    return {
      totalMembers: c.total,
      activeMembers: c.active ?? 0,
      expiredMembers: c.expired ?? 0,
      totalRevenue: fromPaise(c.revenue),
      expiringSoon: expiring.map(toMember),
      revenueByMonth: months.map((m) => ({ month: m.label, revenue: fromPaise(byMonth.get(m.key) ?? 0) })),
      checkedInTodayCount: sessions.length,
      checkedInToday: sessions.map(toSessionWithMember).map((s) => ({ member: s.member, checkedInAt: s.session.checked_in_at })),
    };
  }
}

type RevenueFilters = { where: string; params: Record<string, unknown> };

export class RevenueService {
  constructor(private readonly mgr: DatabaseManager, private readonly members: MembersService, private readonly clock: Clock = systemClock) {}
  private get db() {
    return this.mgr.db;
  }

  private range(q: RevenueQuery) {
    if (Number.isNaN(Date.parse(q.startIso)) || Number.isNaN(Date.parse(q.endIso))) throw new AppError("VALIDATION", "Choose a valid date range.");
    return { start: new Date(q.startIso).toISOString(), end: new Date(q.endIso).toISOString() };
  }

  /** Filters for the transactions table (date range + method + member name). */
  private tableFilters(q: RevenueQuery): RevenueFilters {
    const { start, end } = this.range(q);
    const where = ["p.paid_at >= @start", "p.paid_at < @end"];
    const params: Record<string, unknown> = { start, end };
    if (q.method && q.method !== "all") {
      where.push("p.method = @method");
      params.method = q.method;
    }
    const term = q.query?.trim();
    if (term) {
      where.push("ulower(m.name) LIKE @q ESCAPE '\\'");
      params.q = likeContains(term);
    }
    return { where: `WHERE ${where.join(" AND ")}`, params };
  }

  private orderBy(q: RevenueQuery) {
    const col = q.sortKey === "amount" ? "p.amount_paise" : "p.paid_at";
    return `ORDER BY ${col} ${q.sortDir === "asc" ? "ASC" : "DESC"}, p.rowid DESC`;
  }

  report(q: RevenueQuery): RevenueReport {
    const { start, end } = this.range(q);
    const pageSize = clamp(Math.trunc(q.pageSize ?? 15), 1, 500);
    const page = Math.max(1, Math.trunc(q.page ?? 1));

    // Summary cards + method breakdown follow the date range only (not the table's method/search filters).
    const sum = this.db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount_paise), 0) s FROM payments WHERE paid_at >= ? AND paid_at < ?").get(start, end) as { c: number; s: number };
    const byMethod = { cash: 0, upi: 0, card: 0, other: 0 } as Record<PaymentMethod, number>;
    for (const r of this.db.prepare("SELECT method, SUM(amount_paise) s FROM payments WHERE paid_at >= ? AND paid_at < ? GROUP BY method").all(start, end) as { method: PaymentMethod; s: number }[]) {
      if (PAYMENT_METHOD_VALUES.includes(r.method)) byMethod[r.method] = fromPaise(r.s);
    }

    const f = this.tableFilters(q);
    const from = "FROM payments p JOIN members m ON m.id = p.member_id";
    const t = this.db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(p.amount_paise), 0) s ${from} ${f.where}`).get(f.params) as { c: number; s: number };
    const rows = this.db
      .prepare(`SELECT ${PAYMENT_JOIN_SELECT} ${from} ${f.where} ${this.orderBy(q)} LIMIT @limit OFFSET @offset`)
      .all({ ...f.params, limit: pageSize, offset: (page - 1) * pageSize }) as PaymentJoinRow[];

    const dues = this.db.prepare("SELECT COALESCE(SUM(MAX(0, amount_due_paise - fees_paid_paise)), 0) s FROM members").get() as { s: number };
    return {
      summary: {
        totalAmount: fromPaise(sum.s), paymentCount: sum.c,
        averagePayment: sum.c ? fromPaise(sum.s) / sum.c : 0, byMethod,
      },
      table: { rows: rows.map(toPaymentWithMember), total: t.c, page, pageSize, filteredTotal: fromPaise(t.s) },
      pendingDues: fromPaise(dues.s),
    };
  }

  trend(): Record<RevenueTrendGranularity, RevenueTrendPoint[]> {
    const now = this.clock();
    const rows = this.db.prepare("SELECT paid_at, amount_paise FROM payments WHERE paid_at >= ?").all(trendWindowStart(now).toISOString()) as { paid_at: string; amount_paise: number }[];
    const pays = rows.map((r) => ({ paid_at: r.paid_at, amount: fromPaise(r.amount_paise) }));
    return { daily: revenueTrend(pays, "daily", now), weekly: revenueTrend(pays, "weekly", now), monthly: revenueTrend(pays, "monthly", now) };
  }

  /** Every payment matching the filters (no pagination), for CSV export. */
  allForExport(q: RevenueQuery) {
    const f = this.tableFilters(q);
    const rows = this.db
      .prepare(`SELECT ${PAYMENT_JOIN_SELECT} FROM payments p JOIN members m ON m.id = p.member_id ${f.where} ${this.orderBy(q)}`)
      .all(f.params) as PaymentJoinRow[];
    return rows.map(toPaymentWithMember);
  }
}

export type ExportFile = { fileName: string; content: string };
const BOM = "\uFEFF"; // lets Excel on Windows read names with non-ASCII characters correctly

export class ExportService {
  constructor(private readonly mgr: DatabaseManager, private readonly revenue: RevenueService, private readonly clock: Clock = systemClock) {}

  members(): ExportFile {
    const rows = this.mgr.db.prepare(`SELECT ${MEMBER_COLS} FROM members ORDER BY created_at DESC, id ASC`).all() as MemberRow[];
    const header = ["Name", "Age", "Email", "Phone", "Plan", "Start date", "End date", "Amount due", "Fees paid", "Outstanding", "Status"];
    const body = rows.map(toMember).map((m: Member) => [
      guardFormula(m.name), m.age ?? "", guardFormula(m.email ?? ""), guardFormula(m.phone ?? "", true), guardFormula(m.plan_name ?? ""),
      m.start_date, m.end_date ?? "", m.amount_due, m.fees_paid, Math.max(0, m.amount_due - m.fees_paid), m.status,
    ]);
    return { fileName: `body-temple-gym-members-${toLocalDateStr(this.clock())}.csv`, content: BOM + buildCsv(header, body) };
  }

  revenueCsv(q: RevenueQuery): ExportFile {
    const header = ["Member", "Amount", "Method", "Date", "Notes"];
    const body = this.revenue.allForExport(q).map(({ payment: p, member: m }) => [guardFormula(m.name), p.amount, p.method, p.paid_at, guardFormula(p.notes ?? "")]);
    return { fileName: `body-temple-gym-revenue-${toLocalDateStr(this.clock())}.csv`, content: BOM + buildCsv(header, body) };
  }
}

void newId;
