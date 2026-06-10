import type { NextConfig } from "next";
import { networkInterfaces } from "os";

/**
 * The Next dev server blocks cross-origin requests (RSC navigation, HMR, Server
 * Actions) unless the browsing origin is allowed — so opening the app from
 * another device on the LAN renders the page but leaves it non-interactive.
 *
 * To make `npm run dev:lan` "just work", we auto-allow this machine's own LAN
 * IPv4 addresses. You can add more (e.g. a hostname) via LOOM_DEV_ORIGINS, a
 * comma-separated list. This setting is dev-only — the production server
 * (`npm run start:lan`) ignores it.
 */
function lanOrigins(): string[] {
  const origins = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) origins.add(net.address);
    }
  }
  return [...origins];
}

const envOrigins =
  process.env.LOOM_DEV_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean) ?? [];

const allowedDevOrigins = [...new Set([...lanOrigins(), ...envOrigins])];

const nextConfig: NextConfig = {
  // sqlite-vec locates its platform-specific loadable extension on disk at
  // runtime, so it must stay external to the server bundle.
  serverExternalPackages: ["sqlite-vec"],
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
