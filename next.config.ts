import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The canonical well-known path for the Agent Card. Next does not reliably
  // route dot-prefixed folders, so the card is served by /api/agent-card and the
  // well-known URL rewrites onto it.
  async rewrites() {
    return [{ source: "/.well-known/agent-card.json", destination: "/api/agent-card" }];
  }
};

export default nextConfig;
