"use client";

import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import { RequireSession, useSession } from "@/components/session-provider";

function Shell({ children }: { children: React.ReactNode }) {
  const { state } = useSession();
  const s = state.session!;
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col lg:pl-64">
        <TopBar displayName={s.displayName} email={s.email} />
        <main className="flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <Shell>{children}</Shell>
    </RequireSession>
  );
}
