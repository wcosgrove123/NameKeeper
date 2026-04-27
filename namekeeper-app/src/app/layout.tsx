import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PasswordGate from "@/components/PasswordGate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NameKeeper",
  description: "Patrilineal surname succession tracker",
};

// `viewport-fit=cover` + initialScale=1 lets safe-area-inset-* env() values
// expose the iPhone notch / home-indicator insets so we can pad around them.
// `maximumScale=1` is intentionally NOT set — we don't want to disable user
// pinch-zoom for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <PasswordGate>{children}</PasswordGate>
      </body>
    </html>
  );
}
