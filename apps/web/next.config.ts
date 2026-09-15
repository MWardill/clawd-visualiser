import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The workspace packages export TypeScript source; Next compiles them as part of the app.
  transpilePackages: ["@clawd/core", "@clawd/scene"],
};

// The desktop app serves a static export over app://clawd/ with no Next server (desktop design §7).
// The cloud build and the dev server are unchanged.
if (process.env.CLAWD_TARGET === "desktop") {
  nextConfig.output = "export";
  nextConfig.images = { unoptimized: true };
}

export default nextConfig;
