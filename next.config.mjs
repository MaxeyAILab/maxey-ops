/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Browsers cache the SW script itself via normal HTTP caching (up to
        // 24h by spec) independent of the service worker's own cache logic —
        // without this, a new sw.js can sit unused for a day even though its
        // own activate handler would otherwise wipe stale caches immediately.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
      {
        source: "/manifest.json",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
