"use client";

import { useState } from "react";
import { ClipboardCheck, LayoutGrid, History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Member, Attendance } from "@/types/database";
import type {
  AttendanceStats,
  AttendanceTrendGranularity,
  AttendanceTrendPoint,
} from "@/lib/attendance";
import CheckInPanel from "@/components/check-in-panel";
import AttendanceOverview from "@/components/attendance-overview";
import AttendanceHistory from "@/components/attendance-history";

type Tab = "check-in" | "overview" | "history";

const TABS: { key: Tab; label: string; icon: typeof ClipboardCheck }[] = [
  { key: "check-in", label: "Check in", icon: ClipboardCheck },
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "history", label: "History", icon: History },
];

export default function AttendanceManager({
  members,
  activeSessions,
  stats,
  trend,
  currentlyCheckedIn,
  history,
}: {
  members: Member[];
  activeSessions: { member: Member; session: Attendance }[];
  stats: AttendanceStats;
  trend: Record<AttendanceTrendGranularity, AttendanceTrendPoint[]>;
  currentlyCheckedIn: { member: Member; session: Attendance }[];
  history: { member: Member; session: Attendance }[];
}) {
  const [tab, setTab] = useState<Tab>("check-in");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 border-b-2 border-ink-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-3 font-body text-sm font-medium transition-colors -mb-0.5",
              tab === t.key
                ? "border-mango text-mango"
                : "border-transparent text-paper/50 hover:text-paper"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "check-in" && (
        <CheckInPanel members={members} activeSessions={activeSessions} />
      )}
      {tab === "overview" && (
        <AttendanceOverview
          stats={stats}
          trend={trend}
          currentlyCheckedIn={currentlyCheckedIn}
        />
      )}
      {tab === "history" && <AttendanceHistory history={history} />}
    </div>
  );
}
