import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Next assigns its default title before the serving worker loads this config.
if (process.title.startsWith("next-server")) {
  process.title = "ContextLens Frontend";
}

const nextConfig: NextConfig = {};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
