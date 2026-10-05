"use client";

import AttendanceManager from "@/components/attendance-manager";

export default function CheckInPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Attendance</h2>
        <p className="font-body text-sm text-paper/40">
          Check members in and out, see who&apos;s here, and look back through visit history.
        </p>
      </div>

      <AttendanceManager />
    </div>
  );
}
