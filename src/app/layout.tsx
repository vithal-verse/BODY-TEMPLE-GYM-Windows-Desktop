import type { Metadata } from "next";
import { MotionConfig } from "framer-motion";
import ParticleBackground from "@/components/particle-background";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-sans/800.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Body Temple Gym — Admin",
  description: "Member management for Body Temple Gym.",
  icons: {
    icon: [
      { url: "/brand/logo-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/logo-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-ink text-paper">
        {/* Painted first in DOM order, so it sits behind everything below
            without needing z-index — no ancestor here creates a stacking
            context that would complicate that. */}
        <ParticleBackground />
        {/* reducedMotion="user" makes every Framer Motion animation in the
            app automatically respect the OS-level "reduce motion"
            accessibility setting, without needing to check it manually
            in each component. */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </body>
    </html>
  );
}
