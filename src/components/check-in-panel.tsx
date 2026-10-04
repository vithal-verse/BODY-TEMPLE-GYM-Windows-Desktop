"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Check, LogOut, Loader2, AlertTriangle } from "lucide-react";
import type { Member, Attendance } from "@/types/database";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { playTick } from "@/lib/sounds";
import StatusPill from "@/components/status-pill";

export default function CheckInPanel({
  members,
  activeSessions,
}: {
  members: Member[];
  activeSessions: { member: Member; session: Attendance }[];
}) {
  const [query, setQuery] = useState("");
  // memberId -> their open session, if any. This is the "active check-in"
  // this feature is about — not "checked in today", since a member can
  // check in, check out, and check in again later the same day.
  const [activeByMember, setActiveByMember] = useState<Map<string, Attendance>>(
    () => new Map(activeSessions.map((a) => [a.member.id, a.session]))
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email?.toLowerCase().includes(q) ||
          m.phone?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [query, members]);

  async function handleCheckIn(member: Member) {
    setBusyId(member.id);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("attendance")
      .insert({ member_id: member.id })
      .select("*")
      .single();

    setBusyId(null);

    if (error) {
      if (error.code === "23505") {
        // The unique index caught a race — they already have an active
        // session (checked in from another tab/device since this page
        // loaded). Refresh so the UI catches up to reality.
        alert(`${member.name} already has an active check-in — refreshing.`);
        window.location.reload();
        return;
      }
      alert(`Couldn't check in ${member.name}: ${error.message}`);
      return;
    }

    playTick();
    setActiveByMember((prev) => new Map(prev).set(member.id, data));
    setQuery("");
    inputRef.current?.focus();
  }

  async function handleCheckOut(member: Member, session: Attendance) {
    setBusyId(member.id);
    const supabase = createClient();
    const checkedOutAt = new Date();
    const durationMinutes = Math.max(
      0,
      Math.round(
        (checkedOutAt.getTime() - new Date(session.checked_in_at).getTime()) / 60000
      )
    );

    const { error } = await supabase
      .from("attendance")
      .update({
        checked_out_at: checkedOutAt.toISOString(),
        duration_minutes: durationMinutes,
      })
      .eq("id", session.id);

    setBusyId(null);

    if (error) {
      alert(`Couldn't check out ${member.name}: ${error.message}`);
      return;
    }

    playTick();
    setActiveByMember((prev) => {
      const next = new Map(prev);
      next.delete(member.id);
      return next;
    });
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-paper/30" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name, email, or phone…"
          className="w-full border-2 border-ink-line bg-ink-raised py-4 pl-12 pr-4 font-body text-lg text-paper placeholder:text-paper/30 outline-none focus:border-mango"
        />
      </div>

      {query.trim() === "" ? (
        <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink-line py-16 text-center">
          <p className="font-body text-sm text-paper/35">
            Start typing to find someone.
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-ink-line py-16 text-center">
          <p className="font-display text-lg text-paper/60">No match</p>
          <p className="font-body text-sm text-paper/35">
            Check the spelling, or add them as a new member first.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {results.map((member) => {
              const activeSession = activeByMember.get(member.id);
              const isBusy = busyId === member.id;
              const needsWarning = member.status === "expired" || member.status === "paused";

              return (
                <motion.li
                  key={member.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    "flex flex-col gap-2 border-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
                    needsWarning ? "border-alert/60 bg-alert/5" : "border-ink-line bg-ink-raised"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-body text-base font-medium text-paper">
                        {member.name}
                      </p>
                      <StatusPill status={member.status} />
                    </div>
                    <p className="truncate font-body text-xs text-paper/40">
                      {member.plan_name || "No plan on record"}
                    </p>
                    {needsWarning && (
                      <p className="mt-1 flex items-center gap-1.5 font-body text-xs font-medium text-alert">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {member.status === "expired"
                          ? "Membership expired — checking in anyway is your call"
                          : "Membership is paused — checking in anyway is your call"}
                      </p>
                    )}
                  </div>

                  {activeSession ? (
                    <button
                      onClick={() => handleCheckOut(member, activeSession)}
                      disabled={isBusy}
                      className="flex shrink-0 items-center gap-2 border-2 border-good px-5 py-2.5 font-display text-base tracking-wide text-good transition-colors hover:bg-good hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4" />
                      )}
                      Check out
                      <span className="font-body text-xs font-normal opacity-70">
                        in since{" "}
                        {new Date(activeSession.checked_in_at).toLocaleTimeString("en-IN", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCheckIn(member)}
                      disabled={isBusy}
                      className={cn(
                        "flex shrink-0 items-center gap-2 px-5 py-2.5 font-display text-base tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        needsWarning
                          ? "border-2 border-alert text-alert hover:bg-alert hover:text-ink"
                          : "bg-mango text-ink hover:bg-mango-deep"
                      )}
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Check in
                    </button>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
