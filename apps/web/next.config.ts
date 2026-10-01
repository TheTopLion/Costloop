import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  typedRoutes: false,
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};

export default config;
