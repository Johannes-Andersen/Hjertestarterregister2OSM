// @ts-check

import cloudflare from "@astrojs/cloudflare";
import { defineConfig, fontProviders } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare",
    sessionKVBindingName: "SESSION",
  }),
  prefetch: {
    defaultStrategy: "hover",
    prefetchAll: true,
  },
  experimental: {
    clientPrerender: true,
    fonts: [
      {
        provider: fontProviders.fontsource(),
        name: "Inter",
        cssVariable: "--font-inter",
        weights: [400, 600, 700],
        styles: ["normal"],
        subsets: ["latin"],
        formats: ["woff2"],
        fallbacks: ["system-ui", "sans-serif"],
      },
    ],
  },
});
