import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow isolated builds (e.g. desktop installer packaging) without
  // clobbering the live dev server's .next directory:
  //   NEXT_DIST_DIR=.next-desktop bun run build
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
