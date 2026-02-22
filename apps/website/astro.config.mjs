// @ts-check

import cloudflare from "@astrojs/cloudflare";
import { defineConfig, fontProviders } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://hjertestarterregister2osm.johand.dev/",
  output: "server",
  adapter: cloudflare({
    imageService: "cloudflare",
    sessionKVBindingName: "SESSION",
  }),
  compressHTML: true,
  security: {
    checkOrigin: true,
    allowedDomains: [
      {
        protocol: "https",
        hostname: "hjertestarterregister2osm.johand.dev",
      },
      {
        protocol: "https",
        hostname: "**.johand.workers.dev",
      },
    ],
  },
  prefetch: {
    defaultStrategy: "hover",
    prefetchAll: true,
  },
  experimental: {
    svgo: true,
    chromeDevtoolsWorkspace: true,
    csp: {
      algorithm: "SHA-512",
      directives: [
        "default-src 'self'",
        "object-src 'none'",
        "frame-src 'self' https://challenges.cloudflare.com",
        "connect-src 'self' https://cloudflareinsights.com https://tiles.openfreemap.org",
        "img-src 'self' data: blob:",
      ],
      scriptDirective: {
        resources: [
          "'self'",
          "https://ajax.cloudflare.com",
          "https://static.cloudflareinsights.com",
          "https://challenges.cloudflare.com",
        ],
      },
    },
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
