import "./globals.css";
import type { Viewport } from "next";
import { Inter } from "next/font/google";
import { Aurora } from "@/components/shell/Aurora";
import { AppShell } from "@/components/shell/AppShell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "Sentinel — Post-op Monitor",
  description:
    "AI voice-nurse monitoring for post-operative patients. Catches deterioration before it becomes a 911 call.",
  manifest: "/manifest.webmanifest",
  applicationName: "Sentinel",
  appleWebApp: {
    capable: true,
    title: "Sentinel",
    statusBarStyle: "black-translucent" as const,
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.svg" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1E3D",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* iOS Safari needs explicit apple-mobile-web-app meta tags for Add-to-Home-Screen full-screen. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Sentinel" />
      </head>
      <body className="font-sans">
        <Aurora />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
