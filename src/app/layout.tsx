import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

import { Nav } from "@/components/nav";
import { SearchPalette } from "@/components/search";
import { Toaster } from "@/components/ui/sonner";

// Self-hosted JetBrainsMono Nerd Font (includes icon glyphs) — primary UI font.
const jbMono = localFont({
  variable: "--font-jbmono",
  display: "swap",
  src: [
    {
      path: "../../public/fonts/JetBrainsMonoNerdFont-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/JetBrainsMonoNerdFont-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
});

// 8-bit pixel display font — reserved for the logo and hero headings.
const pixel = Press_Start_2P({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Loom",
  description: "Local-first web UI for a local LLM.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${jbMono.variable} ${pixel.variable} h-full antialiased`}
    >
      <body className="flex h-screen overflow-hidden">
        <Nav />
        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
        <SearchPalette />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
