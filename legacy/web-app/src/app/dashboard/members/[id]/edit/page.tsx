import { notFound } from "next/navigation";
import { getMember } from "@/lib/members";
import { getPlans } from "@/lib/plans";
import MemberForm from "@/components/member-form";

export default async function EditMemberPage({
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
          Edit {member.name}
        </h2>
        <p className="font-body text-sm text-paper/40">
          Update their details below.
        </p>
      </div>

      <div className="max-w-2xl border-2 border-ink-line bg-ink-raised p-6 sm:p-8">
        <MemberForm plans={plans} existingMember={member} />
      </div>
    </div>
  );
}
