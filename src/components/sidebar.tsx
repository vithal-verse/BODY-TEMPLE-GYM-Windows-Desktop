"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LayoutGrid, ClipboardCheck, TrendingUp, Users, UserPlus, Download, X, Menu } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import SoundToggle from "@/components/sound-toggle";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/check-in", label: "Attendance", icon: ClipboardCheck },
  { href: "/dashboard/revenue", label: "Revenue", icon: TrendingUp },
  { href: "/dashboard/members", label: "Members", icon: Users },
  { href: "/dashboard/members/new", label: "Add member", icon: UserPlus },
  { href: "/dashboard/export", label: "Export data", icon: Download },
];

function isNavItemActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

// Declared outside Sidebar so it isn't re-created (and thus fully
// remounted, losing the shared layoutId animation state) on every render.
function NavList({
  layoutIdPrefix,
  pathname,
  onNavigate,
}: {
  layoutIdPrefix: string;
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isNavItemActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className="relative flex items-center gap-3 overflow-hidden px-4 py-3 font-body text-sm font-medium"
          >
            {active && (
              <motion.div
                layoutId={`${layoutIdPrefix}-active-pill`}
                className="absolute inset-0 border-l-4 border-mango bg-mango/10"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <motion.span
              whileHover={{ x: active ? 0 : 4 }}
              whileTap={{ scale: 0.96 }}
              className={cn(
                "relative z-10 flex items-center gap-3",
                active ? "text-mango" : "text-paper/60 hover:text-paper"
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              {label}
            </motion.span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      {/* Mobile top strip */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b-2 border-ink-line bg-ink px-4 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <Image src="/brand/logo.png" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="font-display text-lg text-mango">BODY TEMPLE</span>
        </Link>
        <div className="flex items-center gap-3">
          <SoundToggle className="h-9 w-9" />
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9, rotate: 90 }}
            onClick={() => setMobileOpen((o) => !o)}
            className="text-paper"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </motion.button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 top-16 z-30 bg-ink lg:hidden"
          >
            <div className="pt-4">
              <NavList layoutIdPrefix="mobile" pathname={pathname} onNavigate={closeMobile} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <motion.aside
        initial={{ x: -256, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] as const }}
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r-2 border-ink-line bg-ink lg:flex"
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-3 border-b-2 border-ink-line px-6 py-6"
        >
          <motion.div whileHover={{ rotate: -8, scale: 1.08 }} transition={{ type: "spring", stiffness: 300 }}>
            <Image src="/brand/logo.png" alt="" width={40} height={40} className="h-10 w-10" />
          </motion.div>
          <div className="leading-tight">
            <p className="font-display text-lg tracking-wide text-mango">BODY TEMPLE</p>
            <p className="font-body text-[11px] font-medium tracking-widest text-paper/40">
              GYM ADMIN
            </p>
          </div>
        </Link>
        <div className="flex-1 py-4">
          <NavList layoutIdPrefix="desktop" pathname={pathname} onNavigate={closeMobile} />
        </div>
        <div className="hazard-edge h-1.5" />
      </motion.aside>

      {/* Spacer for mobile fixed header */}
      <div className="h-16 lg:hidden" />
    </>
  );
}
