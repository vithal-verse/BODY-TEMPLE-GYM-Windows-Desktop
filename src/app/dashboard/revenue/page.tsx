import { getAllPaymentsWithMembers, getOutstandingSummary } from "@/lib/payments";
import RevenueDashboard from "@/components/revenue-dashboard";

export default async function RevenuePage() {
  const [allPayments, outstanding] = await Promise.all([
    getAllPaymentsWithMembers(),
    getOutstandingSummary(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl text-paper">Revenue</h2>
        <p className="font-body text-sm text-paper/40">
          Every payment, broken down by time and method.
        </p>
      </div>

      <RevenueDashboard allPayments={allPayments} outstanding={outstanding} />
    </div>
  );
}
