"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  ArrowUpDown,
  Pencil,
  RotateCw,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Member } from "@/types/database";
import { formatCurrency, formatDate, daysUntil, cn } from "@/lib/utils";
import StatusPill from "@/components/status-pill";
import { createClient } from "@/lib/supabase/client";

type SortKey = "name" | "start_date" | "end_date" | "fees_paid";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 10;

export default function MembersTable({ members }: { members: Member[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilter =
    (searchParams.get("filter") as
      | "all"
      | "active"
      | "expired"
      | "paused"
      | "expiring") || "all";

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "expired" | "paused" | "expiring"
  >(initialFilter);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [localMembers, setLocalMembers] = useState(members);

  const filtered = useMemo(() => {
    let result = localMembers;

    if (
      statusFilter === "active" ||
      statusFilter === "expired" ||
      statusFilter === "paused"
    ) {
      result = result.filter((m) => m.status === statusFilter);
    } else if (statusFilter === "expiring") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + 7);
      result = result.filter((m) => {
        if (!m.end_date || m.status !== "active") return false;
        const end = new Date(m.end_date);
        return end >= today && end <= cutoff;
      });
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email?.toLowerCase().includes(q) ||
          m.phone?.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "fees_paid") cmp = a.fees_paid - b.fees_paid;
      else {
        const aVal = a[sortKey] ? new Date(a[sortKey]!).getTime() : 0;
        const bVal = b[sortKey] ? new Date(b[sortKey]!).getTime() : 0;
        cmp = aVal - bVal;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [localMembers, statusFilter, query, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove ${name} from the member list? This can't be undone.`))
      return;

    setDeletingId(id);
    const supabase = createClient();
    const { error } = await supabase.from("members").delete().eq("id", id);
    setDeletingId(null);

    if (error) {
      alert(`Couldn't delete member: ${error.message}`);
      return;
    }

    setLocalMembers((prev) => prev.filter((m) => m.id !== id));
    router.refresh();
  }

  const FILTERS: { key: typeof statusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "expired", label: "Expired" },
    { key: "paused", label: "Paused" },
    { key: "expiring", label: "Expiring soon" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper/30" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, email, phone…"
            className="w-full border-2 border-ink-line bg-ink-raised py-2.5 pl-10 pr-3 font-body text-sm text-paper placeholder:text-paper/30 outline-none focus:border-mango"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setStatusFilter(f.key);
                setPage(1);
              }}
              className={cn(
                "border-2 px-3 py-2 font-body text-xs font-semibold uppercase tracking-wide transition-colors",
                statusFilter === f.key
                  ? "border-mango bg-mango text-ink"
                  : "border-ink-line text-paper/50 hover:border-paper/30 hover:text-paper"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {paginated.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink-line py-16 text-center">
          <p className="font-display text-lg text-paper/60">
            No members match
          </p>
          <p className="font-body text-sm text-paper/35">
            Try a different search term or filter.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border-2 border-ink-line">
          <table className="w-full min-w-[880px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink-line bg-ink-raised">
                <Th label="Name" onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir} />
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Plan
                </th>
                <Th label="Start" onClick={() => toggleSort("start_date")} active={sortKey === "start_date"} dir={sortDir} />
                <Th label="End" onClick={() => toggleSort("end_date")} active={sortKey === "end_date"} dir={sortDir} />
                <Th label="Fees paid" onClick={() => toggleSort("fees_paid")} active={sortKey === "fees_paid"} dir={sortDir} />
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  onDelete={() => handleDelete(m.id, m.name)}
                  deleting={deletingId === m.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-paper/40">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 border-2 border-ink-line px-3 py-2 font-body text-xs font-medium text-paper/60 transition-colors hover:border-mango hover:text-mango disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 border-2 border-ink-line px-3 py-2 font-body text-xs font-medium text-paper/60 transition-colors hover:border-mango hover:text-mango disabled:cursor-not-allowed disabled:opacity-30"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  label,
  onClick,
  active,
  dir,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
}) {
  return (
    <th className="px-4 py-3 text-left">
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-1.5 font-body text-xs font-semibold uppercase tracking-wide transition-colors",
          active ? "text-mango" : "text-paper/50 hover:text-paper"
        )}
      >
        {label}
        <ArrowUpDown
          className={cn(
            "h-3 w-3 transition-transform",
            active && dir === "desc" && "rotate-180"
          )}
        />
      </button>
    </th>
  );
}

function MemberRow({
  member,
  onDelete,
  deleting,
}: {
  member: Member;
  onDelete: () => void;
  deleting: boolean;
}) {
  const remaining = daysUntil(member.end_date);
  const isExpiringSoon =
    member.status === "active" && remaining !== null && remaining <= 7;

  return (
    <tr className="border-b border-ink-line last:border-b-0 hover:bg-ink-raised">
      <td className="px-4 py-3">
        <Link
          href={`/dashboard/members/${member.id}`}
          className="font-body text-sm font-medium text-paper hover:text-mango"
        >
          {member.name}
        </Link>
        {member.email && (
          <p className="font-body text-xs text-paper/35">{member.email}</p>
        )}
      </td>
      <td className="px-4 py-3 font-body text-sm text-paper/70">
        {member.plan_name || "—"}
      </td>
      <td className="px-4 py-3 font-body text-sm text-paper/70">
        {formatDate(member.start_date)}
      </td>
      <td className="px-4 py-3 font-body text-sm">
        <span className={isExpiringSoon ? "text-alert" : "text-paper/70"}>
          {formatDate(member.end_date)}
        </span>
      </td>
      <td className="px-4 py-3 font-body text-sm text-paper/70">
        {formatCurrency(member.fees_paid)}
        {member.amount_due - member.fees_paid > 0 && (
          <span className="ml-2 text-xs font-semibold text-alert">
            {formatCurrency(member.amount_due - member.fees_paid)} due
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={member.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/dashboard/members/${member.id}/renew`}
            className="flex h-8 w-8 items-center justify-center border-2 border-ink-line text-paper/50 transition-colors hover:border-mango hover:text-mango"
            aria-label={`Renew ${member.name}`}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </Link>
          <Link
            href={`/dashboard/members/${member.id}/edit`}
            className="flex h-8 w-8 items-center justify-center border-2 border-ink-line text-paper/50 transition-colors hover:border-mango hover:text-mango"
            aria-label={`Edit ${member.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex h-8 w-8 items-center justify-center border-2 border-ink-line text-paper/50 transition-colors hover:border-alert hover:text-alert disabled:opacity-40"
            aria-label={`Delete ${member.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
