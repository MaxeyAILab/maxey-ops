import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";

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
  themeColor: "#f5820b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
