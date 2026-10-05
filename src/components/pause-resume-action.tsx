"use client";

import { useState } from "react";
import { Pause, Play, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useDialog } from "@/components/dialog-provider";
import { useRefresh } from "@/components/session-provider";
import type { Member } from "@/types/database";

export default function PauseResumeAction({ member }: { member: Member }) {
  const dialog = useDialog();
  const refresh = useRefresh();
  const [loading, setLoading] = useState(false);

  async function handlePause() {
    const ok = await dialog.confirm(
      `Pause ${member.name}'s membership? Their end date stays put until you resume them — it won't count down while paused.`,
      { title: "Pause membership", confirmLabel: "Pause" }
    );
    if (!ok) return;
    setLoading(true);
    try {
      await api.members.pause({ id: member.id });
      refresh();
    } catch (err) {
      await dialog.alert(`Couldn't pause: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }

  // Resuming pushes the end date forward by exactly how long they were paused, so no paid time is lost.
  async function handleResume() {
    setLoading(true);
    try {
      await api.members.resume({ id: member.id });
      refresh();
    } catch (err) {
      await dialog.alert(`Couldn't resume: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
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
