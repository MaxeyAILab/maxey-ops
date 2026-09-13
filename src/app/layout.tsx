import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";

// App-wide typeface (2026-09 retheme, matching the Finance tab). The public
// marketing page (src/app/page.tsx) sets its own fonts via next/font and
// ignores this — only the authenticated app inherits it.
const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-archivo" });

export const metadata: Metadata = {
  title: {
    default: "Maxey Construction",
    template: "%s | Maxey Construction",
  },
  description:
    "Maxey Construction — PCAB-registered contractor in San Isidro, Nueva Ecija. Residential, commercial, industrial, and infrastructure projects.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0b6e5a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={archivo.className}>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
