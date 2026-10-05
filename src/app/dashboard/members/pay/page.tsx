"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import RecordPaymentForm from "@/components/record-payment-form";
import { NotFoundState, PageState } from "@/components/page-state";

function RecordPayment() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error } = useAsync(async () => {
    const [member, currentRenewal] = await Promise.all([api.members.get({ id }), api.members.currentRenewal({ memberId: id })]);
    return { member, currentRenewal };
  }, [id]);
  if (!data) return <PageState error={error} />;
  const { member, currentRenewal } = data;
  if (!member) return <NotFoundState what="member" />;

  if (!currentRenewal) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-paper">No term on record for {member.name}</h2>
        <p className="font-body text-sm text-paper/40">
          There&apos;s no renewal history to attach a payment to yet. Use Renew to start their first term.
        </p>
        <Link href={`/dashboard/members/renew?id=${id}`} className="w-fit bg-mango px-5 py-2.5 font-display text-base text-ink">
          Go to Renew
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Record a payment — {member.name}</h2>
        <p className="font-body text-sm text-paper/40">Logs a payment against their current term without starting a new one.</p>
      </div>

      <div className="max-w-xl border-2 border-ink-line bg-ink-raised p-6 sm:p-8">
        <RecordPaymentForm member={member} currentRenewal={currentRenewal} />
      </div>
    </div>
  );
}

export default function RecordPaymentPage() {
  return (
    <Suspense fallback={<PageState />}>
      <RecordPayment />
    </Suspense>
  );
}
