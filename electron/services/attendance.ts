import { AppError } from "@shared/errors";
import { attendanceTrend, trendWindowStart } from "@shared/trends";
import type {
  Attendance, AttendanceHistoryQuery, AttendanceStats, AttendanceTrendGranularity, AttendanceTrendPoint,
  AttendanceWithMember, Page,
} from "@shared/types";
import { likeContains, runInTransaction } from "../database/connection";
import type { DatabaseManager } from "../database/manager";
import { type AttendanceRow, SESSION_JOIN_SELECT, type SessionJoinRow, toAttendance, toSessionWithMember } from "./mappers";
import { clamp, dayBoundsIso, isDateStr, minutesBetween, newId, systemClock, toLocalDateStr, type Clock } from "./util";

const isUnique = (e: unknown) => typeof e === "object" && e !== null && String((e as { code?: string }).code ?? "").startsWith("SQLITE_CONSTRAINT_UNIQUE");

export class AttendanceService {
  constructor(private readonly mgr: DatabaseManager, private readonly clock: Clock = systemClock) {}
  private get db() {
    return this.mgr.db;
  }

  checkIn(memberId: string): Attendance {
    try {
      return runInTransaction(this.db, () => {
        const m = this.db.prepare("SELECT id, name FROM members WHERE id = ?").get(memberId) as { id: string; name: string } | undefined;
        if (!m) throw new AppError("NOT_FOUND", "That member no longer exists.");
        if (this.db.prepare("SELECT 1 FROM attendance WHERE member_id = ? AND checked_out_at IS NULL").get(memberId)) {
          throw new AppError("ALREADY_CHECKED_IN", `${m.name} already has an active check-in.`);
        }
        const id = newId();
        const at = this.clock().toISOString();
        this.db.prepare("INSERT INTO attendance (id, member_id, checked_in_at) VALUES (?, ?, ?)").run(id, memberId, at);
        return { id, member_id: memberId, checked_in_at: at, checked_out_at: null, duration_minutes: null };
      });
    } catch (e) {
      if (isUnique(e)) throw new AppError("ALREADY_CHECKED_IN", "That member already has an active check-in.");
      throw e;
    }
  }

  checkOut(sessionId: string): Attendance {
    return runInTransaction(this.db, () => {
      const row = this.db.prepare("SELECT * FROM attendance WHERE id = ?").get(sessionId) as AttendanceRow | undefined;
      if (!row) throw new AppError("NOT_FOUND", "That check-in no longer exists.");
      if (row.checked_out_at) throw new AppError("CONFLICT", "That visit was already checked out.");
      const out = this.clock().toISOString();
      const minutes = minutesBetween(row.checked_in_at, out);
      this.db.prepare("UPDATE attendance SET checked_out_at = ?, duration_minutes = ? WHERE id = ?").run(out, minutes, sessionId);
      return toAttendance({ ...row, checked_out_at: out, duration_minutes: minutes });
    });
  }

  /** Everyone currently on the floor, from any day (a forgotten check-out stays visible). */
  active(): AttendanceWithMember[] {
    const rows = this.db
      .prepare(`SELECT ${SESSION_JOIN_SELECT} FROM attendance a JOIN members m ON m.id = a.member_id WHERE a.checked_out_at IS NULL ORDER BY a.checked_in_at DESC, a.rowid DESC`)
      .all() as SessionJoinRow[];
    return rows.map(toSessionWithMember);
  }

  stats(): AttendanceStats {
    const { startIso, endIso } = dayBoundsIso(toLocalDateStr(this.clock()));
    const today = this.db
      .prepare("SELECT checked_out_at, duration_minutes FROM attendance WHERE checked_in_at >= ? AND checked_in_at < ?")
      .all(startIso, endIso) as { checked_out_at: string | null; duration_minutes: number | null }[];
    const completed = today.filter((a) => a.checked_out_at !== null && a.duration_minutes !== null);
    const avg = completed.length ? Math.round(completed.reduce((s, a) => s + (a.duration_minutes ?? 0), 0) / completed.length) : null;
    const open = (this.db.prepare("SELECT COUNT(*) c FROM attendance WHERE checked_out_at IS NULL").get() as { c: number }).c;
    return { todaysCheckInCount: today.length, currentlyCheckedInCount: open, todaysCheckoutCount: completed.length, averageDurationMinutesToday: avg };
  }

  trend(): Record<AttendanceTrendGranularity, AttendanceTrendPoint[]> {
    const now = this.clock();
    const rows = this.db.prepare("SELECT checked_in_at FROM attendance WHERE checked_in_at >= ?").all(trendWindowStart(now).toISOString()) as { checked_in_at: string }[];
    const times = rows.map((r) => r.checked_in_at);
    return { daily: attendanceTrend(times, "daily", now), weekly: attendanceTrend(times, "weekly", now), monthly: attendanceTrend(times, "monthly", now) };
  }

  history(q: AttendanceHistoryQuery = {}): Page<AttendanceWithMember> {
    const pageSize = clamp(Math.trunc(q.pageSize ?? 20), 1, 200);
    const page = Math.max(1, Math.trunc(q.page ?? 1));
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    const term = q.query?.trim();
    if (term) {
      where.push("ulower(m.name) LIKE @q ESCAPE '\\'");
      params.q = likeContains(term);
    }
    if (q.startDate && isDateStr(q.startDate)) {
      where.push("a.checked_in_at >= @start");
      params.start = dayBoundsIso(q.startDate).startIso;
    }
    if (q.endDate && isDateStr(q.endDate)) {
      where.push("a.checked_in_at < @end");
      params.end = dayBoundsIso(q.endDate).endIso;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN members m ON m.id = a.member_id ${whereSql}`).get(params) as { c: number }).c;
    const rows = this.db
      .prepare(`SELECT ${SESSION_JOIN_SELECT} FROM attendance a JOIN members m ON m.id = a.member_id ${whereSql} ORDER BY a.checked_in_at DESC, a.rowid DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as SessionJoinRow[];
    return { rows: rows.map(toSessionWithMember), total, page, pageSize };
  }

  memberHistory(input: { memberId: string; limit?: number }): Attendance[] {
    const rows = this.db
      .prepare("SELECT * FROM attendance WHERE member_id = ? ORDER BY checked_in_at DESC, rowid DESC LIMIT ?")
      .all(input.memberId, clamp(Math.trunc(input.limit ?? 20), 1, 500)) as AttendanceRow[];
    return rows.map(toAttendance);
  }
}
