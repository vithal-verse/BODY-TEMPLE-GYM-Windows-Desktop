import { createClient } from "@/lib/supabase/server";
import { getMembers } from "@/lib/members";
import type { Attendance, Member } from "@/types/database";

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getTodaysAttendance(): Promise<Attendance[]> {
  const supabase = await createClient();
  const { start, end } = todayRange();

  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .gte("checked_in_at", start)
    .lt("checked_in_at", end)
    .order("checked_in_at", { ascending: false });

  if (error) {
    console.error("getTodaysAttendance error:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getMemberAttendanceHistory(
  memberId: string,
  limit = 20
): Promise<Attendance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("member_id", memberId)
    .order("checked_in_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getMemberAttendanceHistory error:", error.message);
    return [];
  }
  return data ?? [];
}

/** The member's current open session (checked in, not yet checked out),
 *  if any. Powers both "prevent duplicate active check-ins" and the
 *  checkout button. */
export async function getActiveCheckIn(memberId: string): Promise<Attendance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("member_id", memberId)
    .is("checked_out_at", null)
    .order("checked_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getActiveCheckIn error:", error.message);
    return null;
  }
  return data;
}

/** Everyone with an open session right now, across all members — not
 *  scoped to today, so a forgotten checkout from a prior day still shows
 *  up rather than silently vanishing. */
export async function getCurrentlyCheckedIn(): Promise<
  { member: Member; session: Attendance }[]
> {
  const supabase = await createClient();
  const [{ data: sessions, error }, members] = await Promise.all([
    supabase
      .from("attendance")
      .select("*")
      .is("checked_out_at", null)
      .order("checked_in_at", { ascending: false }),
    getMembers(),
  ]);

  if (error) {
    console.error("getCurrentlyCheckedIn error:", error.message);
    return [];
  }

  const membersById = new Map(members.map((m) => [m.id, m]));
  return (sessions ?? [])
    .map((session) => {
      const member = membersById.get(session.member_id);
      return member ? { member, session } : null;
    })
    .filter((entry): entry is { member: Member; session: Attendance } => entry !== null);
}

export interface AttendanceStats {
  todaysCheckInCount: number;
  currentlyCheckedInCount: number;
  todaysCheckoutCount: number;
  averageDurationMinutesToday: number | null;
}

export async function getAttendanceStats(): Promise<AttendanceStats> {
  const [todaysAttendance, currentlyCheckedIn] = await Promise.all([
    getTodaysAttendance(),
    getCurrentlyCheckedIn(),
  ]);

  const completedToday = todaysAttendance.filter(
    (a) => a.checked_out_at !== null && a.duration_minutes !== null
  );
  const averageDurationMinutesToday =
    completedToday.length > 0
      ? Math.round(
          completedToday.reduce((sum, a) => sum + (a.duration_minutes ?? 0), 0) /
            completedToday.length
        )
      : null;

  return {
    todaysCheckInCount: todaysAttendance.length,
    currentlyCheckedInCount: currentlyCheckedIn.length,
    todaysCheckoutCount: completedToday.length,
    averageDurationMinutesToday,
  };
}

export type AttendanceTrendGranularity = "daily" | "weekly" | "monthly";

export interface AttendanceTrendPoint {
  label: string;
  count: number;
}

/** Bucketed check-in counts for the trend chart — last 14 days, last 8
 *  weeks, or last 6 months, matching the granularity requested. */
export async function getAttendanceTrend(
  granularity: AttendanceTrendGranularity
): Promise<AttendanceTrendPoint[]> {
  const supabase = await createClient();

  const now = new Date();
  const rangeStart = new Date(now);
  if (granularity === "daily") rangeStart.setDate(rangeStart.getDate() - 13);
  else if (granularity === "weekly") rangeStart.setDate(rangeStart.getDate() - 7 * 7);
  else rangeStart.setMonth(rangeStart.getMonth() - 5);
  rangeStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("attendance")
    .select("checked_in_at")
    .gte("checked_in_at", rangeStart.toISOString())
    .order("checked_in_at", { ascending: true });

  if (error) {
    console.error("getAttendanceTrend error:", error.message);
    return [];
  }

  const rows = data ?? [];

  if (granularity === "daily") {
    const buckets: AttendanceTrendPoint[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets.push({ label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), count: 0 });
    }
    rows.forEach((r) => {
      const d = new Date(r.checked_in_at);
      const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
      const idx = 13 - daysAgo;
      if (idx >= 0 && idx < buckets.length) buckets[idx].count++;
    });
    return buckets;
  }

  if (granularity === "weekly") {
    const buckets: AttendanceTrendPoint[] = [];
    const weekStarts: Date[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7 - now.getDay());
      d.setHours(0, 0, 0, 0);
      weekStarts.push(d);
      buckets.push({ label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), count: 0 });
    }
    rows.forEach((r) => {
      const d = new Date(r.checked_in_at);
      for (let i = weekStarts.length - 1; i >= 0; i--) {
        if (d >= weekStarts[i]) {
          buckets[i].count++;
          break;
        }
      }
    });
    return buckets;
  }

  // monthly
  const buckets: AttendanceTrendPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ label: d.toLocaleDateString("en-IN", { month: "short" }), count: 0 });
  }
  rows.forEach((r) => {
    const d = new Date(r.checked_in_at);
    const monthsAgo =
      (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (monthsAgo >= 0 && monthsAgo <= 5) {
      buckets[5 - monthsAgo].count++;
    }
  });
  return buckets;
}

export interface AttendanceHistoryFilters {
  query?: string;
  startDate?: string; // yyyy-MM-dd
  endDate?: string; // yyyy-MM-dd
}

/** Powers the History tab: every visit across all members, filterable by
 *  name and date range, newest first. */
export async function searchAttendanceHistory(
  filters: AttendanceHistoryFilters = {}
): Promise<{ member: Member; session: Attendance }[]> {
  const supabase = await createClient();

  let request = supabase.from("attendance").select("*").order("checked_in_at", { ascending: false });

  if (filters.startDate) {
    request = request.gte("checked_in_at", `${filters.startDate}T00:00:00`);
  }
  if (filters.endDate) {
    request = request.lte("checked_in_at", `${filters.endDate}T23:59:59`);
  }

  const [{ data: sessions, error }, members] = await Promise.all([
    request,
    getMembers(),
  ]);

  if (error) {
    console.error("searchAttendanceHistory error:", error.message);
    return [];
  }

  const membersById = new Map(members.map((m) => [m.id, m]));
  const q = filters.query?.trim().toLowerCase();

  return (sessions ?? [])
    .map((session) => {
      const member = membersById.get(session.member_id);
      return member ? { member, session } : null;
    })
    .filter((entry): entry is { member: Member; session: Attendance } => entry !== null)
    .filter((entry) => !q || entry.member.name.toLowerCase().includes(q));
}
