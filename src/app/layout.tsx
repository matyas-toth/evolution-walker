/**
 * Root layout for the Evolution Walker application.
 * Forces dark mode, sets global fonts and metadata.
 * @module app/layout
 */

import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Instrument_Sans,
  Bricolage_Grotesque,
} from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage-grotesque",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Evolution Walker",
  description:
    "Design soft-body 2D creatures and train them to walk using genetic algorithms",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} ${bricolageGrotesque.variable} antialiased font-sans`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
