import { notFound } from "next/navigation";
import { getMember } from "@/lib/members";
import { getPlans } from "@/lib/plans";
import RenewForm from "@/components/renew-form";

export default async function RenewMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [member, plans] = await Promise.all([getMember(id), getPlans()]);

  if (!member) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">
          Renew {member.name}
        </h2>
        <p className="font-body text-sm text-paper/40">
          Start a new term. Their current plan, dates, and fees stay in
          history — this doesn&apos;t overwrite anything.
        </p>
      </div>

      <div className="max-w-2xl border-2 border-ink-line bg-ink-raised p-6 sm:p-8">
        <RenewForm member={member} plans={plans} />
      </div>
    </div>
  );
}
