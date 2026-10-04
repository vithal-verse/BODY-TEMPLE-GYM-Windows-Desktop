import { getPlans } from "@/lib/plans";
import MemberForm from "@/components/member-form";

export default async function NewMemberPage() {
  const plans = await getPlans();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Add a member</h2>
        <p className="font-body text-sm text-paper/40">
          Fill in their details to add them to the floor.
        </p>
      </div>

      <div className="max-w-2xl border-2 border-ink-line bg-ink-raised p-6 sm:p-8">
        <MemberForm plans={plans} />
      </div>
    </div>
  );
}
