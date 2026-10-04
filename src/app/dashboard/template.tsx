"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";

/**
 * Next.js remounts `template.tsx` (unlike layout.tsx) on every navigation
 * within its segment, which is exactly what we want here: the Sidebar and
 * TopBar live in dashboard/layout.tsx and stay mounted/static, while just
 * this content area gets a fresh, fast fade+rise on every route change —
 * Overview → Members → Export, etc. Kept short (0.3s) on purpose so it
 * reads as "responsive," not as a delay before the Members table is usable.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
