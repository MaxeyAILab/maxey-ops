import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";
import { ImageLinkViewer } from "@/components/image-link-viewer";
import { THEME_INIT_SCRIPT } from "@/components/theme-toggle";

// App-wide typeface (2026-09 retheme, matching the Finance tab). The public
// marketing page (src/app/page.tsx) sets its own fonts via next/font and
// ignores this — only the authenticated app inherits it.
const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-archivo" });
// Staff app (2026-11 retheme): Space Grotesk for text, JetBrains Mono for figures (font-mono) — applied via .app-shell in globals.css
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-space" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: {
    default: "Maxey Construction",
    template: "%s | Maxey Construction",
  },
  description:
    "Maxey Construction — PCAB-registered contractor in San Isidro, Nueva Ecija. Residential, commercial, industrial, and infrastructure projects.",
  manifest: "/manifest.json",
  // The picture iPhones use when the app is added to the Home Screen (also lets notifications work there).
  icons: { apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Maxey Ops", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff7f3" },
    { media: "(prefers-color-scheme: dark)", color: "#07080f" },
  ],
  width: "device-width",
  initialScale: 1,
  // lets the app use the whole phone screen; the bars add their own padding for the notch and home bar (safe areas)
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Runs before paint so the stored/OS theme applies immediately —
            without this, the page would flash light before hydrating dark. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${archivo.className} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
        <SwRegister />
        {children}
        <ImageLinkViewer />
      </body>
    </html>
  );
}
