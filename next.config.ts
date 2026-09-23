import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server serve its cross-origin resources (HMR, RSC
  // payloads, etc.) when opened via this machine's Tailscale IP instead
  // of localhost - otherwise those get silently blocked, which can break
  // client-side interactivity without a loud console error.
  allowedDevOrigins: ["100.90.77.15"],
};

export default nextConfig;
