import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
