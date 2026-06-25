import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Load Inter through Next.js's built-in font system.
// This self-hosts the font (fast, no layout shift) and exposes it
// as a CSS variable we use across the whole app.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Revise Creative Dashboard",
  description: "Internal creative operations dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}