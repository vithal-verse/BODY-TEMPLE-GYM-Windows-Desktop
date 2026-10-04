import { createClient } from "@/lib/supabase/server";
import type { Renewal } from "@/types/database";

export async function getRenewalHistory(memberId: string): Promise<Renewal[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("renewals")
    .select("*")
    .eq("member_id", memberId)
    .order("start_date", { ascending: false });

  if (error) {
    console.error("getRenewalHistory error:", error.message);
    return [];
  }
  return data ?? [];
}

/** The member's most recent term — what a new payment or correction
 *  should attach to. */
export async function getCurrentRenewal(memberId: string): Promise<Renewal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("renewals")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getCurrentRenewal error:", error.message);
    return null;
  }
  return data;
}
