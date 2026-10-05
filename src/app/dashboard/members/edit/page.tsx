"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import MemberForm from "@/components/member-form";
import { NotFoundState, PageState } from "@/components/page-state";

function EditMember() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error } = useAsync(async () => {
    const [member, plans] = await Promise.all([api.members.get({ id }), api.plans.list()]);
    return { member, plans };
  }, [id]);
  if (!data) return <PageState error={error} />;
  const { member, plans } = data;
  if (!member) return <NotFoundState what="member" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Edit {member.name}</h2>
        <p className="font-body text-sm text-paper/40">Update their details below.</p>
      </div>

      <div className="max-w-2xl border-2 border-ink-line bg-ink-raised p-6 sm:p-8">
        <MemberForm plans={plans} existingMember={member} />
      </div>
    </div>
  );
}

export default function EditMemberPage() {
  return (
    <Suspense fallback={<PageState />}>
      <EditMember />
    </Suspense>
  );
}
