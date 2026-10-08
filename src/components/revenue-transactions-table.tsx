"use client";

import { useState } from "react";
import { Search, ArrowUpDown, Download, Banknote, Smartphone, CreditCard, MoreHorizontal } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import { useDebounced } from "@/lib/use-debounced";
import { useDialog } from "@/components/dialog-provider";
import { PageState } from "@/components/page-state";
import type { PaymentMethod } from "@/types/database";
import { cn, formatCurrency } from "@/lib/utils";

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  upi: Smartphone,
  card: CreditCard,
  other: MoreHorizontal,
};

const METHOD_FILTERS: { key: PaymentMethod | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cash", label: "Cash" },
  { key: "upi", label: "UPI" },
  { key: "card", label: "Card" },
  { key: "other", label: "Other" },
];

type SortKey = "paid_at" | "amount";
const PAGE_SIZE = 15;

export default function RevenueTransactionsTable({ startIso, endIso }: { startIso: string; endIso: string }) {
  const dialog = useDialog();
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("paid_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const debouncedQuery = useDebounced(query, 250);

  const filters = { startIso, endIso, method: methodFilter, query: debouncedQuery, sortKey, sortDir } as const;
  const { data, error } = useAsync(
    () => api.revenue.report({ ...filters, page, pageSize: PAGE_SIZE }),
    [startIso, endIso, methodFilter, debouncedQuery, sortKey, sortDir, page]
  );
  if (!data) return <PageState error={error} />;
  const table = data.table;
  const paginated = table.rows;
  const totalPages = Math.max(1, Math.ceil(table.total / PAGE_SIZE));

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await api.exports.revenue(filters); // every row matching the filters, via the Windows "Save as" dialog
    } catch (err) {
      await dialog.alert(`Couldn't export the transactions: ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper/30" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by member name…"
            className="w-full border-2 border-ink-line bg-ink-raised py-2.5 pl-10 pr-3 font-body text-sm text-paper placeholder:text-paper/30 outline-none focus:border-mango"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {METHOD_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setMethodFilter(f.key);
                setPage(1);
              }}
              className={cn(
                "border-2 px-3 py-2 font-body text-xs font-semibold uppercase tracking-wide transition-colors",
                methodFilter === f.key
                  ? "border-mango bg-mango text-ink"
                  : "border-ink-line text-paper/50 hover:border-paper/30"
              )}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={handleExport}
            disabled={table.total === 0 || exporting}
            className="flex items-center gap-2 bg-mango px-3 py-2 font-body text-xs font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-mango-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>

      <p className="font-body text-xs text-paper/40">
        {table.total} {table.total === 1 ? "transaction" : "transactions"} —{" "}
        {formatCurrency(table.filteredTotal)} total.
      </p>

      {paginated.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink-line py-16 text-center">
          <p className="font-body text-sm text-paper/40">No transactions match.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border-2 border-ink-line">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b-2 border-ink-line bg-ink-raised">
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Member
                </th>
                <Th label="Amount" active={sortKey === "amount"} dir={sortDir} onClick={() => toggleSort("amount")} />
                <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase tracking-wide text-paper/50">
                  Method
                </th>
                <Th label="Date" active={sortKey === "paid_at"} dir={sortDir} onClick={() => toggleSort("paid_at")} />
              </tr>
            </thead>
            <tbody>
              {paginated.map(({ payment, member }) => {
                const Icon = METHOD_ICONS[payment.method];
                return (
                  <tr key={payment.id} className="border-b border-ink-line last:border-b-0 hover:bg-ink-raised">
                    <td className="px-4 py-3 font-body text-sm text-paper">{member.name}</td>
                    <td className="px-4 py-3 font-body text-sm text-paper/70">
                      {formatCurrency(payment.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 font-body text-xs uppercase tracking-wide text-paper/60">
                        <Icon className="h-3.5 w-3.5 text-mango" />
                        {payment.method}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-paper/70">
                      {new Date(payment.paid_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                );
              })}
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

function Th({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
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
        <ArrowUpDown className={cn("h-3 w-3 transition-transform", active && dir === "asc" && "rotate-180")} />
      </button>
    </th>
  );
}
