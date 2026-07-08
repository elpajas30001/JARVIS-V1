import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow server-side Node.js modules in API routes
  serverExternalPackages: ["systeminformation"],
};

export default nextConfig;
