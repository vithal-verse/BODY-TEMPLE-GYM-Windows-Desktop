"use client";

import { Users, UserCheck, LogOut, Timer } from "lucide-react";
import type { Member, Attendance } from "@/types/database";
import type {
  AttendanceStats,
  AttendanceTrendGranularity,
  AttendanceTrendPoint,
} from "@/lib/attendance";
import { formatDuration } from "@/lib/utils";
import AttendanceTrendChart from "@/components/attendance-trend-chart";

export default function AttendanceOverview({
  stats,
  trend,
  currentlyCheckedIn,
}: {
  stats: AttendanceStats;
  trend: Record<AttendanceTrendGranularity, AttendanceTrendPoint[]>;
  currentlyCheckedIn: { member: Member; session: Attendance }[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Users}
          label="Today's check-ins"
          value={String(stats.todaysCheckInCount)}
        />
        <StatTile
          icon={UserCheck}
          label="Currently checked in"
          value={String(stats.currentlyCheckedInCount)}
          accent
        />
        <StatTile
          icon={LogOut}
          label="Checked out today"
          value={String(stats.todaysCheckoutCount)}
        />
        <StatTile
          icon={Timer}
          label="Avg. visit today"
          value={formatDuration(stats.averageDurationMinutesToday)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="border-2 border-ink-line bg-ink-raised p-6 lg:col-span-2">
          <h2 className="mb-1 font-display text-xl text-paper">Attendance trend</h2>
          <p className="mb-4 font-body text-sm text-paper/40">
            Check-in counts over time.
          </p>
          <AttendanceTrendChart data={trend} />
        </div>

        <div className="flex flex-col border-2 border-ink-line bg-ink-raised p-6">
          <h2 className="font-display text-xl text-paper">On the floor now</h2>
          <p className="mb-4 font-body text-sm text-paper/40">
            {currentlyCheckedIn.length === 0
              ? "Nobody's currently checked in."
              : `${currentlyCheckedIn.length} ${currentlyCheckedIn.length === 1 ? "person" : "people"} checked in right now.`}
          </p>

          {currentlyCheckedIn.length > 0 && (
            <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {currentlyCheckedIn.map(({ member, session }) => (
                <li
                  key={session.id}
                  className="flex items-center justify-between border-2 border-ink-line px-4 py-2.5"
                >
                  <span className="truncate font-body text-sm text-paper">{member.name}</span>
                  <span className="shrink-0 font-body text-xs text-paper/40">
                    since{" "}
                    {new Date(session.checked_in_at).toLocaleTimeString("en-IN", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "flex flex-col gap-3 border-2 border-mango bg-mango p-5 text-ink"
          : "flex flex-col gap-3 border-2 border-ink-line bg-ink-raised p-5 text-paper"
      }
    >
      <div className="flex items-center justify-between">
        <span
          className={
            accent
              ? "font-body text-xs font-semibold uppercase tracking-wide text-ink/70"
              : "font-body text-xs font-semibold uppercase tracking-wide text-paper/45"
          }
        >
          {label}
        </span>
        <Icon className={accent ? "h-4 w-4 text-ink/60" : "h-4 w-4 text-mango"} strokeWidth={2} />
      </div>
      <p className="font-display text-3xl leading-none">{value}</p>
    </div>
  );
}
