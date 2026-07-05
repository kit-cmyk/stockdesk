import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted via next/font: bundled at build time (no external requests, so
// the PWA keeps working offline) and served as variable fonts.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
import { Providers } from "./providers";
import { AuthGate } from "@/components/AuthGate";
import { BottomNav } from "@/components/BottomNav";
import { Sidebar } from "@/components/Sidebar";
import { SyncBanner } from "@/components/SyncBanner";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "StockDesk",
  description: "Offline-first inventory management for web and mobile.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "StockDesk" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS ignores SVG apple-touch-icons — must be a raster image.
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f8fc",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body suppressHydrationWarning>
        <Providers>
          <AuthGate>
            <div className="flex min-h-dvh w-full">
              <Sidebar />
              <main className="flex-1 pb-24 md:pb-0">
                <TopBar />
                <SyncBanner />
                <div className="mx-auto w-full max-w-6xl">{children}</div>
              </main>
              <BottomNav />
            </div>
          </AuthGate>
        </Providers>
      </body>
    </html>
  );
}
