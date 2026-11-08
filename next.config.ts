import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow isolated builds (e.g. desktop installer packaging) without
  // clobbering the live dev server's .next directory:
  //   NEXT_DIST_DIR=.next-desktop bun run build
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // P6.4: type errors MUST fail the build — checked separately as well via
  // `bun run typecheck`. Never ship an installer from a type-broken tree.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  poweredByHeader: false,
};

export default nextConfig;
