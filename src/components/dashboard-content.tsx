"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Users, UserCheck, UserX, Wallet, ClipboardCheck, ArrowRight } from "lucide-react";
import type { DashboardStats } from "@/lib/members";
import { formatCurrency, formatDate, daysUntil, cn } from "@/lib/utils";
import StatCard from "@/components/stat-card";
import RevenueChart from "@/components/revenue-chart";

const statGridVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.05 },
  },
};

const panelVariants = {
  hidden: { opacity: 0, y: 40 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
  },
};

const listVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.07, delayChildren: 0.15 },
  },
};

const listItemVariants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const } },
};

export default function DashboardContent({ stats }: { stats: DashboardStats }) {
  return (
    <div className="flex flex-col gap-8">
      {/* Stat grid — staggered entrance, each card counts up on mount */}
      <motion.div
        variants={statGridVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <StatCard label="Total members" value={stats.totalMembers} icon={Users} accent />
        <StatCard
          label="Active"
          value={stats.activeMembers}
          icon={UserCheck}
          sublabel="Currently training"
        />
        <StatCard
          label="Expired"
          value={stats.expiredMembers}
          icon={UserX}
          sublabel="Needs renewal"
        />
        <StatCard
          label="Checked in today"
          value={stats.checkedInTodayCount}
          icon={ClipboardCheck}
          sublabel="On the floor today"
        />
        <StatCard
          label="Total revenue"
          value={stats.totalRevenue}
          format={formatCurrency}
          icon={Wallet}
          sublabel="Fees collected to date"
        />
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Revenue chart — reveals as it scrolls into view */}
        <motion.div
          variants={panelVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="border-2 border-ink-line bg-ink-raised p-6 lg:col-span-2"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-xl text-paper">
              Revenue, last 6 months
            </h2>
          </div>
          <p className="mb-4 font-body text-sm text-paper/40">
            Fees collected, grouped by the month each membership started.
          </p>
          <RevenueChart data={stats.revenueByMonth} />
        </motion.div>

        {/* Expiring soon — reveals with its own list stagger */}
        <motion.div
          variants={panelVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="flex flex-col border-2 border-ink-line bg-ink-raised p-6"
        >
          <h2 className="font-display text-xl text-paper">Expiring soon</h2>
          <p className="mb-4 font-body text-sm text-paper/40">
            Active memberships ending within 7 days.
          </p>

          {stats.expiringSoon.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <p className="font-body text-sm text-paper/40">
                Nothing expiring this week. Clear floor ahead.
              </p>
            </div>
          ) : (
            <motion.ul
              variants={listVariants}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              className="flex flex-1 flex-col gap-3 overflow-y-auto"
            >
              {stats.expiringSoon.slice(0, 6).map((m) => {
                const remaining = daysUntil(m.end_date);
                return (
                  <motion.li key={m.id} variants={listItemVariants}>
                    <motion.div whileHover={{ x: 6 }} whileTap={{ x: 2 }}>
                      <Link
                        href={`/dashboard/members/${m.id}/renew`}
                        className="flex items-center justify-between border-2 border-ink-line px-4 py-3 transition-colors hover:border-mango"
                      >
                        <div>
                          <p className="font-body text-sm font-medium text-paper">
                            {m.name}
                          </p>
                          <p className="font-body text-xs text-paper/40">
                            Ends {formatDate(m.end_date)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "font-display text-sm",
                            remaining !== null && remaining <= 2
                              ? "text-alert"
                              : "text-mango"
                          )}
                        >
                          {remaining === 0 ? "Today" : `${remaining}d`}
                        </span>
                      </Link>
                    </motion.div>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="group">
            <Link
              href="/dashboard/members?filter=expiring"
              className="mt-4 flex items-center justify-center gap-2 border-2 border-ink-line py-2.5 font-body text-sm font-medium text-paper/70 transition-colors hover:border-mango hover:text-mango"
            >
              View all members
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </motion.div>
      </div>

      {/* Today's check-ins — reveals as it scrolls into view */}
      <motion.div
        variants={panelVariants}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        className="border-2 border-ink-line bg-ink-raised p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl text-paper">
              Today&apos;s check-ins
            </h2>
            <p className="font-body text-sm text-paper/40">
              Members who&apos;ve come through today, most recent first.
            </p>
          </div>
          <Link
            href="/dashboard/check-in"
            className="flex items-center gap-2 border-2 border-ink-line px-4 py-2.5 font-body text-sm font-medium text-paper/70 transition-colors hover:border-mango hover:text-mango"
          >
            <ClipboardCheck className="h-4 w-4" />
            Check in
          </Link>
        </div>

        {stats.checkedInToday.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <p className="font-body text-sm text-paper/40">
              Nobody&apos;s checked in yet today.
            </p>
          </div>
        ) : (
          <motion.ul
            variants={listVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="flex flex-wrap gap-2"
          >
            {stats.checkedInToday.map(({ member, checkedInAt }, i) => (
              <motion.li
                key={`${member.id}-${i}`}
                variants={listItemVariants}
                className="flex items-center gap-2 border-2 border-ink-line px-4 py-2"
              >
                <span className="font-body text-sm text-paper">{member.name}</span>
                <span className="font-body text-xs text-paper/40">
                  {new Date(checkedInAt).toLocaleTimeString("en-IN", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </motion.div>
    </div>
  );
}
