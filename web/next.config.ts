import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @hivefund/shared ships TypeScript sources (no build step).
  transpilePackages: ["@hivefund/shared"],
  // Monorepo root, so file tracing picks up ../data/sample and ../config on hosted builds.
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  outputFileTracingIncludes: {
    "/api/**": ["./fixtures/**/*", "../data/sample/**/*", "../config/*.json"],
  },
  turbopack: {
    root: path.join(process.cwd(), ".."),
  },
};

export default nextConfig;
