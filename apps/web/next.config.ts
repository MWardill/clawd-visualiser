import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The workspace packages export TypeScript source; Next compiles them as part of the app.
  transpilePackages: ["@clawd/core", "@clawd/scene"],
};

export default nextConfig;
