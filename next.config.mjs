const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy: the browser only runs scripts, styles and loads images from this site (and photos
// taken in the app, which are data:/blob: URLs). `object-src 'none'` and `frame-ancestors 'none'` stop plugin
// content and any other site from putting this one in a frame (clickjacking). Next.js writes small inline
// scripts to start the page, so script-src still needs 'unsafe-inline' until the app moves to per-request
// nonces; the other directives are what give this policy its value today. 'unsafe-eval' is development only.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  // the small map shown when someone taps "View map" on a recorded location (OpenStreetMap, free)
  "frame-src https://www.openstreetmap.org",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Older browsers that ignore frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop the browser guessing a file's type (so an uploaded file can't be run as a script).
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera for site photos and location for attendance/deliveries are the only features the app uses.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), bluetooth=(), serial=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework version in every response.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
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
