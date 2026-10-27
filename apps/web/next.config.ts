import type { NextConfig } from "next";
import { lanAddress } from "./lan-address";

const lan = lanAddress();

const nextConfig: NextConfig = {
  // Checkout links point phones at this computer's network address (see
  // src/lib/lan.ts). The dev server only accepts its HMR socket from
  // localhost unless told otherwise, and without it the page never hydrates.
  allowedDevOrigins: lan ? [lan] : [],
  cacheComponents: true,
  experimental: {
    agentUpgrade: "security",
  },
  partialPrefetching: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@continuity/checkout"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
