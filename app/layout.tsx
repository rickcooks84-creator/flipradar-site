import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlipSonar — Retail Arbitrage Scanner",
  description: "Paste any store URL. FlipSonar scrapes every product, checks eBay sold comps, and scores each one 1–100 so you know exactly what to buy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
