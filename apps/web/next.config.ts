import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prefer modern output; keep builds deterministic for production.
  reactStrictMode: true,
  // Tree-shake heavy icon/package imports when present.
  experimental: {
    optimizePackageImports: ["sonner"],
  },
  // Avoid accidental source map bloat in prod client bundles
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
};

export default nextConfig;
