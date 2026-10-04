"use client";

import { Volume2, VolumeX } from "lucide-react";
import { motion } from "framer-motion";
import { useSoundEnabled } from "@/lib/sounds";
import { cn } from "@/lib/utils";

export default function SoundToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useSoundEnabled();

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      aria-label={enabled ? "Mute sound effects" : "Unmute sound effects"}
      aria-pressed={enabled}
      title={enabled ? "Sound on" : "Sound off"}
      className={cn(
        "flex items-center justify-center border-2 border-ink-line text-paper/60 transition-colors hover:border-mango hover:text-mango",
        className
      )}
    >
      {enabled ? (
        <Volume2 className="h-4 w-4" strokeWidth={2} />
      ) : (
        <VolumeX className="h-4 w-4" strokeWidth={2} />
      )}
    </motion.button>
  );
}
