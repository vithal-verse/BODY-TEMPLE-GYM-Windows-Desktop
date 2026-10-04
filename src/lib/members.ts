import { createClient } from "@/lib/supabase/server";
import { getTodaysAttendance } from "@/lib/attendance";
import type { Member } from "@/types/database";

export async function getMembers(): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getMembers error:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getMember(id: string): Promise<Member | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("getMember error:", error.message);
    return null;
  }
  return data;
}

export interface DashboardStats {
  totalMembers: number;
  activeMembers: number;
  expiredMembers: number;
  totalRevenue: number;
  expiringSoon: Member[];
  revenueByMonth: { month: string; revenue: number }[];
  checkedInTodayCount: number;
  checkedInToday: { member: Member; checkedInAt: string }[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [members, todaysAttendance] = await Promise.all([
    getMembers(),
    getTodaysAttendance(),
  ]);

  const totalMembers = members.length;
  const activeMembers = members.filter((m) => m.status === "active").length;
  const expiredMembers = members.filter((m) => m.status === "expired").length;
  const totalRevenue = members.reduce((sum, m) => sum + (m.fees_paid || 0), 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soonCutoff = new Date(today);
  soonCutoff.setDate(soonCutoff.getDate() + 7);

  const expiringSoon = members
    .filter((m) => {
      if (!m.end_date || m.status !== "active") return false;
      const end = new Date(m.end_date);
      return end >= today && end <= soonCutoff;
    })
    .sort(
      (a, b) =>
        new Date(a.end_date!).getTime() - new Date(b.end_date!).getTime()
    );

  // Revenue for the trailing 6 months, bucketed by member.start_date's month.
  const monthBuckets: { month: string; revenue: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthBuckets.push({
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      revenue: 0,
    });
  }
  members.forEach((m) => {
    const d = new Date(m.start_date);
    const monthsAgo =
      (today.getFullYear() - d.getFullYear()) * 12 +
      (today.getMonth() - d.getMonth());
    if (monthsAgo >= 0 && monthsAgo <= 5) {
      const idx = 5 - monthsAgo;
      monthBuckets[idx].revenue += m.fees_paid || 0;
    }
  });

  // Cross-referenced in plain JS rather than a Supabase embedded/joined
  // select — keeps this on the same well-tested query shape as everywhere
  // else in the app, rather than leaning on relational type inference for
  // one feature.
  const membersById = new Map(members.map((m) => [m.id, m]));
  const checkedInToday = todaysAttendance
    .map((a) => {
      const member = membersById.get(a.member_id);
      return member ? { member, checkedInAt: a.checked_in_at } : null;
    })
    .filter((entry): entry is { member: Member; checkedInAt: string } => entry !== null);

  return {
    totalMembers,
    activeMembers,
    expiredMembers,
    totalRevenue,
    expiringSoon,
    revenueByMonth: monthBuckets,
    checkedInTodayCount: todaysAttendance.length,
    checkedInToday,
  };
}
