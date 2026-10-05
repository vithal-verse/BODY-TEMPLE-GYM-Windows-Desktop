"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import MemberForm from "@/components/member-form";
import { PageState } from "@/components/page-state";

export default function NewMemberPage() {
  const { data: plans, error } = useAsync(() => api.plans.list(), []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Add a member</h2>
        <p className="font-body text-sm text-paper/40">Fill in their details to add them to the floor.</p>
      </div>

      <div className="max-w-2xl border-2 border-ink-line bg-ink-raised p-6 sm:p-8">
        {plans ? <MemberForm plans={plans} /> : <PageState error={error} />}
      </div>
    </div>
  );
}
