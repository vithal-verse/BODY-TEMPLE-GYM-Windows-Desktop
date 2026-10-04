import { getMembers } from "@/lib/members";
import {
  getCurrentlyCheckedIn,
  getAttendanceStats,
  getAttendanceTrend,
  searchAttendanceHistory,
} from "@/lib/attendance";
import AttendanceManager from "@/components/attendance-manager";

export default async function CheckInPage() {
  const [members, currentlyCheckedIn, stats, daily, weekly, monthly, history] =
    await Promise.all([
      getMembers(),
      getCurrentlyCheckedIn(),
      getAttendanceStats(),
      getAttendanceTrend("daily"),
      getAttendanceTrend("weekly"),
      getAttendanceTrend("monthly"),
      searchAttendanceHistory(),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Attendance</h2>
        <p className="font-body text-sm text-paper/40">
          Check members in and out, see who&apos;s here, and look back through
          visit history.
        </p>
      </div>

      <AttendanceManager
        members={members}
        activeSessions={currentlyCheckedIn}
        stats={stats}
        trend={{ daily, weekly, monthly }}
        currentlyCheckedIn={currentlyCheckedIn}
        history={history}
      />
    </div>
  );
}
