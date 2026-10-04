"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/lib/use-count-up";
import type { LucideIcon } from "lucide-react";

export default function StatCard({
  label,
  value,
  format,
  icon: Icon,
  accent = false,
  sublabel,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  icon: LucideIcon;
  accent?: boolean;
  sublabel?: string;
}) {
  const animated = useCountUp(value);
  const display = format ? format(Math.round(animated)) : String(Math.round(animated));

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 28 },
        show: { opacity: 1, y: 0 },
      }}
      whileHover={{ y: -6 }}
      whileTap={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={cn(
        "flex flex-col gap-4 border-2 p-6",
        accent
          ? "border-mango bg-mango text-ink"
          : "border-ink-line bg-ink-raised text-paper"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "font-body text-xs font-semibold tracking-wide",
            accent ? "text-ink/70" : "text-paper/45"
          )}
        >
          {label}
        </span>
        <motion.span
          whileHover={{ rotate: 12, scale: 1.15 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <Icon
            className={cn("h-5 w-5", accent ? "text-ink/60" : "text-mango")}
            strokeWidth={2}
          />
        </motion.span>
      </div>
      <div>
        <p className="font-display text-4xl leading-none tabular-nums">
          {display}
        </p>
        {sublabel && (
          <p
            className={cn(
              "mt-2 font-body text-sm",
              accent ? "text-ink/60" : "text-paper/40"
            )}
          >
            {sublabel}
          </p>
        )}
      </div>
    </motion.div>
  );
}
