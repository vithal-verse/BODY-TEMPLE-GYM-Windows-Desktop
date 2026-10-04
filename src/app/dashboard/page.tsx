import { getDashboardStats } from "@/lib/members";
import DashboardContent from "@/components/dashboard-content";

export default async function DashboardOverview() {
  const stats = await getDashboardStats();

  return <DashboardContent stats={stats} />;
}
