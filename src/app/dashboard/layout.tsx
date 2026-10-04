import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const displayName =
    profile?.full_name || user.email?.split("@")[0] || "Admin";

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col lg:pl-64">
        <TopBar displayName={displayName} email={user.email ?? ""} />
        <main className="flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
