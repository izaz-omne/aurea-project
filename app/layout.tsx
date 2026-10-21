import type { Metadata, Viewport } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "./landing.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const figures = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-figures" });

export const metadata: Metadata = {
  title: "Aurea — Light writes Dhaka",
  description: "A photographer's forecast for tomorrow's light in Dhaka and beyond.",
};

export const viewport: Viewport = {
  themeColor: "#eeefeb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${figures.variable}`} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
