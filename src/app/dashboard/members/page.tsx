"use client";

import { Suspense } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import MembersTable from "@/components/members-table";
import { PageState } from "@/components/page-state";

export default function MembersPage() {
  const { data } = useAsync(() => api.members.list({ pageSize: 1 }), []);
  const total = data?.total;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-2xl text-paper">All members</h2>
          <p className="font-body text-sm text-paper/40">
            {total === undefined ? "Loading…" : `${total} ${total === 1 ? "member" : "members"} on record.`}
          </p>
        </div>
        <Link
          href="/dashboard/members/new"
          className="flex items-center justify-center gap-2 bg-mango px-5 py-3 font-display text-base tracking-wide text-ink transition-colors hover:bg-mango-deep"
        >
          <UserPlus className="h-[18px] w-[18px]" />
          Add member
        </Link>
      </div>

      <Suspense fallback={<PageState />}>
        <MembersTable />
      </Suspense>
    </div>
  );
}
