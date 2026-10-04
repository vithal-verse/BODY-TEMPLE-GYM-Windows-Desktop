"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO, addDays, differenceInCalendarDays } from "date-fns";
import { Pause, Play, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@/types/database";

export default function PauseResumeAction({ member }: { member: Member }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handlePause() {
    if (
      !confirm(
        `Pause ${member.name}'s membership? Their end date stays put until you resume them — it won't count down while paused.`
      )
    ) {
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("members")
      .update({
        status: "paused",
        paused_at: format(new Date(), "yyyy-MM-dd"),
      })
      .eq("id", member.id);

    setLoading(false);
    if (error) {
      alert(`Couldn't pause: ${error.message}`);
      return;
    }
    router.refresh();
  }

  async function handleResume() {
    setLoading(true);
    const supabase = createClient();

    // Push the end date forward by exactly how long they were paused, so
    // no paid time is lost — a fixed end_date wasn't touched while paused.
    let newEndDate = member.end_date;
    if (member.paused_at && member.end_date) {
      const daysPaused = Math.max(
        0,
        differenceInCalendarDays(new Date(), parseISO(member.paused_at))
      );
      newEndDate = format(
        addDays(parseISO(member.end_date), daysPaused),
        "yyyy-MM-dd"
      );
    }

    const { error } = await supabase
      .from("members")
      .update({ status: "active", paused_at: null, end_date: newEndDate })
      .eq("id", member.id);

    setLoading(false);
    if (error) {
      alert(`Couldn't resume: ${error.message}`);
      return;
    }
    router.refresh();
  }

  if (member.status === "paused") {
    return (
      <button
        onClick={handleResume}
        disabled={loading}
        className="flex items-center justify-center gap-2 bg-mango px-5 py-2.5 font-display text-base tracking-wide text-ink transition-colors hover:bg-mango-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Resume
      </button>
    );
  }

  if (member.status === "active") {
    return (
      <button
        onClick={handlePause}
        disabled={loading}
        className="flex items-center justify-center gap-2 border-2 border-ink-line px-5 py-2.5 font-display text-base tracking-wide text-paper/70 transition-colors hover:border-mango hover:text-mango disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
        Pause
      </button>
    );
  }

  return null;
}
