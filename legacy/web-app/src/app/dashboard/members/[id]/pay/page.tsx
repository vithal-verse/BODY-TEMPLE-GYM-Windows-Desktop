import { notFound } from "next/navigation";
import Link from "next/link";
import { getMember } from "@/lib/members";
import { getCurrentRenewal } from "@/lib/renewals";
import RecordPaymentForm from "@/components/record-payment-form";

export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [member, currentRenewal] = await Promise.all([
    getMember(id),
    getCurrentRenewal(id),
  ]);

  if (!member) notFound();

  if (!currentRenewal) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-paper">
          No term on record for {member.name}
        </h2>
        <p className="font-body text-sm text-paper/40">
          There&apos;s no renewal history to attach a payment to yet. Use
          Renew to start their first term.
        </p>
        <Link
          href={`/dashboard/members/${id}/renew`}
          className="w-fit bg-mango px-5 py-2.5 font-display text-base text-ink"
        >
          Go to Renew
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">
          Record a payment — {member.name}
        </h2>
        <p className="font-body text-sm text-paper/40">
          Logs a payment against their current term without starting a new
          one.
        </p>
      </div>

      <div className="max-w-xl border-2 border-ink-line bg-ink-raised p-6 sm:p-8">
        <RecordPaymentForm member={member} currentRenewal={currentRenewal} />
      </div>
    </div>
  );
}
