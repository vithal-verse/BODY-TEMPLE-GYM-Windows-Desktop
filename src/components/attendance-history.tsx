"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import StatusPill from "@/components/status-pill";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { useDebounced } from "@/lib/use-debounced";
import { PageState } from "@/components/page-state";

const PAGE_SIZE = 20;

export default function AttendanceHistory() {
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebounced(query, 250);

  // Filtering by name and (local) date range, plus paging, is done by the database.
  const { data, error } = useAsync(
    () =>
      api.attendance.history({
        query: debouncedQuery,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [debouncedQuery, startDate, endDate, page]
  );
  if (!data) return <PageState error={error} />;
  const total = data.total;
  const paginated = data.rows;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
        {total} {total === 1 ? "visit" : "visits"} found.
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
