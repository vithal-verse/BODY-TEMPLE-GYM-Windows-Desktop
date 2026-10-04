"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.5 } },
};

const fieldIn = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const } },
};

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "That email and password don't match our records."
          : signInError.message
      );
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <motion.form
      variants={container}
      initial="hidden"
      animate="show"
      onSubmit={handleSubmit}
      className="mt-8 flex flex-col gap-5"
    >
      <motion.div variants={fieldIn} className="flex flex-col gap-2">
        <label
          htmlFor="email"
          className="font-body text-sm font-medium text-paper/80"
        >
          Email
        </label>
        <motion.input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@bodytemplegym.com"
          whileFocus={{ scale: 1.015 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="w-full border-2 border-ink-line bg-ink px-4 py-3 font-body text-paper placeholder:text-paper/30 outline-none transition-colors focus:border-mango"
        />
      </motion.div>

      <motion.div variants={fieldIn} className="flex flex-col gap-2">
        <label
          htmlFor="password"
          className="font-body text-sm font-medium text-paper/80"
        >
          Password
        </label>
        <div className="relative">
          <motion.input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            whileFocus={{ scale: 1.015 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="w-full border-2 border-ink-line bg-ink px-4 py-3 pr-12 font-body text-paper placeholder:text-paper/30 outline-none transition-colors focus:border-mango"
          />
          <motion.button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.9 }}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-paper/40 hover:text-mango"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" />
            ) : (
              <Eye className="h-5 w-5" />
            )}
          </motion.button>
        </div>
      </motion.div>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="border-l-4 border-alert bg-alert/10 px-4 py-3 font-body text-sm text-alert"
        >
          {error}
        </motion.p>
      )}

      <motion.button
        variants={fieldIn}
        type="submit"
        disabled={loading}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className="mt-2 flex items-center justify-center gap-2 bg-mango px-6 py-3.5 font-display text-lg tracking-wide text-ink transition-colors hover:bg-mango-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Signing in…
          </>
        ) : (
          "Log in"
        )}
      </motion.button>
    </motion.form>
  );
}
