import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // If you're reaching the dev server from somewhere other than localhost (another device's IP,
  // a Cloudflare quick tunnel's *.trycloudflare.com host, etc.), list those origins here — Next.js
  // otherwise blocks cross-origin dev/HMR requests from them, which breaks client-side hydration
  // (symptoms: clicks on the splash page silently do nothing). "10.0.30.14" is this dev host's LAN
  // IP (from `hostname -I`) — update it here if that IP ever changes.
  allowedDevOrigins: ["*.trycloudflare.com", "10.0.30.14"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
