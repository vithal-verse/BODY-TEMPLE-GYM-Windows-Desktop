import { cn } from "@/lib/utils";
import type { MemberStatus } from "@/types/database";

const STYLES: Record<MemberStatus, string> = {
  active: "border-good text-good",
  expired: "border-alert text-alert",
  paused: "border-mango text-mango",
};

const DOT: Record<MemberStatus, string> = {
  active: "bg-good",
  expired: "bg-alert",
  paused: "bg-mango",
};

export default function StatusPill({ status }: { status: MemberStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2.5 py-1 font-body text-xs font-semibold uppercase tracking-wide",
        STYLES[status]
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[status])} />
      {status}
    </span>
  );
}
