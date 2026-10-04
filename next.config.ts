import type { NextConfig } from "next";

/**
 * The renderer is a fully static export (no Node server at runtime). The
 * Electron main process serves `out/` over a private `app://` protocol and
 * all data access goes through the preload IPC bridge — see
 * DESKTOP-MIGRATION.md.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
