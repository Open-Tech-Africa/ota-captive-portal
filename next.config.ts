import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // The dev server is reached from more than localhost: the LXC's management-network and
  // hotspot-VLAN addresses, plus the Cloudflare quick tunnel used to test M-Pesa's callback.
  // Without this, Next.js blocks cross-origin dev/HMR requests from those origins, which breaks
  // client-side hydration (symptoms: clicks on the splash page silently do nothing).
  allowedDevOrigins: [
    "10.0.30.27",
    "172.16.20.145",
    "unless-implemented-reward-synthetic.trycloudflare.com",
  ],
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
