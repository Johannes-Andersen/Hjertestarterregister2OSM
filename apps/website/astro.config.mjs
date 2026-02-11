// @ts-check

import node from "@astrojs/node";
import { defineConfig, fontProviders } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
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
