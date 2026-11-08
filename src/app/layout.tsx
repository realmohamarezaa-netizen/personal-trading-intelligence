import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Personal Trading Intelligence — MT5 Analytics",
  description:
    "Local-first trading analytics platform: performance, risk, time and behavioral analysis for your MetaTrader 5 account.",
  // Local favicon — the app must render correctly fully offline (no CDN).
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
