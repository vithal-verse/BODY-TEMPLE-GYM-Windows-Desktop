import { createClient } from "@/lib/supabase/server";
import type { MembershipPlan } from "@/types/database";

export async function getPlans(): Promise<MembershipPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("membership_plans")
    .select("*")
    .order("fee_amount", { ascending: true });

  if (error) {
    console.error("getPlans error:", error.message);
    return [];
  }
  return data ?? [];
}
