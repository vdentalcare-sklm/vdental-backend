import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { initializeDatabase } from "@/lib/db";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "V Dental Backend",
  description: "V Dental Hospitals — Backend API",
};

// Initialize DB schema on every cold start
// Neon is serverless so this is safe to call repeatedly — all CREATE TABLE IF NOT EXISTS
initializeDatabase().catch((err) => {
  console.error("Failed to initialize database on startup:", err);
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}