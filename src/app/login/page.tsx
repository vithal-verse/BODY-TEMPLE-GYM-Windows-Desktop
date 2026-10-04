"use client";

import { motion } from "framer-motion";
import LoginForm from "./login-form";
import Image from "next/image";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const riseIn = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } },
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* Left: identity panel */}
      <section className="relative flex flex-1 flex-col justify-between overflow-hidden px-8 py-10 lg:px-16 lg:py-14">
        {/* Ambient glow — slow breathing pulse behind the hero logo */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-mango/20 blur-[100px]"
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Corner hazard strip — slides in from the left on load */}
        <motion.div
          className="hazard-edge absolute inset-x-0 top-0 h-2"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: "left" }}
        />

        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="relative z-10 flex items-center gap-3"
        >
          <Image
            src="/brand/logo.png"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10"
          />
          <span className="font-body text-sm font-semibold tracking-wide text-paper/70">
            Body Temple Gym
          </span>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="relative z-10 flex flex-col items-start gap-8 py-16 lg:py-0"
        >
          <motion.div
            variants={{
              hidden: { opacity: 0, scale: 0.7, rotate: -8 },
              show: {
                opacity: 1,
                scale: 1,
                rotate: 0,
                transition: { type: "spring", stiffness: 200, damping: 16 },
              },
            }}
          >
            <Image
              src="/brand/logo.png"
              alt="Body Temple Gym"
              width={220}
              height={220}
              priority
              className="h-40 w-40 lg:h-56 lg:w-56"
            />
          </motion.div>
          <div>
            <h1 className="font-display text-5xl leading-[0.95] text-mango sm:text-6xl lg:text-7xl">
              <motion.span variants={riseIn} className="block overflow-hidden">
                Run the
              </motion.span>
              <motion.span variants={riseIn} className="block overflow-hidden">
                floor.
              </motion.span>
            </h1>
            <motion.p
              variants={riseIn}
              className="mt-4 max-w-sm font-body text-base text-paper/60"
            >
              Sign in to manage members, track dues, and keep the gym
              running — from the front desk or the office.
            </motion.p>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
          className="relative z-10 font-body text-xs text-paper/30"
        >
          Admin access only. Contact the gym owner if you need an account.
        </motion.p>
      </section>

      {/* Right: form panel — slides in from the right */}
      <motion.section
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-1 items-center justify-center bg-ink-raised px-8 py-14 lg:px-16"
      >
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl text-paper">Admin login</h2>
          <p className="mt-2 font-body text-sm text-paper/50">
            Enter your credentials to open the dashboard.
          </p>
          <LoginForm />
        </div>
      </motion.section>
    </main>
  );
}
