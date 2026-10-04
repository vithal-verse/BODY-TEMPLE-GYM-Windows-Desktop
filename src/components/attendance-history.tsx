"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Member, Attendance } from "@/types/database";
import { formatDuration } from "@/lib/utils";
import StatusPill from "@/components/status-pill";

const PAGE_SIZE = 20;

export default function AttendanceHistory({
  history,
}: {
  history: { member: Member; session: Attendance }[];
}) {
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter(({ member, session }) => {
      if (q && !member.name.toLowerCase().includes(q)) return false;
      const checkInDate = session.checked_in_at.slice(0, 10);
      if (startDate && checkInDate < startDate) return false;
      if (endDate && checkInDate > endDate) return false;
      return true;
    });
  }, [history, query, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative flex-1 sm:min-w-[220px]">
          <label className="mb-1.5 block font-body text-xs font-medium text-paper/60">
            Member name
          </label>
          <Search className="pointer-events-none absolute left-3 top-[34px] h-4 w-4 -translate-y-1/2 text-paper/30" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name…"
            className="w-full border-2 border-ink-line bg-ink-raised py-2.5 pl-10 pr-3 font-body text-sm text-paper placeholder:text-paper/30 outline-none focus:border-mango"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-body text-xs font-medium text-paper/60">
            From
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
            className="border-2 border-ink-line bg-ink-raised px-3 py-2.5 font-body text-sm text-paper outline-none focus:border-mango"
          />
        </div>
        <div>
          <label className="mb-1.5 block font-body text-xs font-medium text-paper/60">
            To
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
            className="border-2 border-ink-line bg-ink-raised px-3 py-2.5 font-body text-sm text-paper outline-none focus:border-mango"
          />
        </div>
        {(query || startDate || endDate) && (
          <button
            onClick={() => {
              setQuery("");
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}
            className="border-2 border-ink-line px-3 py-2.5 font-body text-xs font-medium text-paper/50 transition-colors hover:border-mango hover:text-mango"
          >
            Clear
          </button>
        )}
      </div>

      <p className="font-body text-xs text-paper/40">
        {filtered.length} {filtered.length === 1 ? "visit" : "visits"} found.
      </p>

      {paginated.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink-line py-16 text-center">
          <p className="font-body text-sm text-paper/40">No visits match.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border-2 border-ink-line">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink-line bg-ink-raised">
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Member
                </th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Check-in
                </th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Check-out
                </th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Duration
                </th>
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(({ member, session }) => (
                <tr key={session.id} className="border-b border-ink-line last:border-b-0 hover:bg-ink-raised">
                  <td className="px-4 py-3 font-body text-sm text-paper">{member.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-paper/70">
                    {new Date(session.checked_in_at).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 font-body text-sm text-paper/70">
                    {session.checked_out_at
                      ? new Date(session.checked_out_at).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-body text-sm text-paper/70">
                    {formatDuration(session.duration_minutes)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={member.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-paper/40">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="border-2 border-ink-line px-3 py-2 font-body text-xs font-medium text-paper/60 transition-colors hover:border-mango hover:text-mango disabled:cursor-not-allowed disabled:opacity-30"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="border-2 border-ink-line px-3 py-2 font-body text-xs font-medium text-paper/60 transition-colors hover:border-mango hover:text-mango disabled:cursor-not-allowed disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
