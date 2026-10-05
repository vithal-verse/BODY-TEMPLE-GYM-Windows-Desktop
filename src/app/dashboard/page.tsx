"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/use-async";
import DashboardContent from "@/components/dashboard-content";
import { PageState } from "@/components/page-state";

export default function DashboardOverview() {
  const { data, error } = useAsync(() => api.dashboard.stats(), []);
  if (!data) return <PageState error={error} />;
  return <DashboardContent stats={data} />;
}
