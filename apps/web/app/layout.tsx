import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { AppThemeProvider, ThemeSync } from "@/lib/theme";
import { ThemeAwareToaster } from "@/components/theme/ThemeAwareToaster";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Massive Mentor CRM",
    template: "%s · Massive Mentor",
  },
  description: "Enterprise AI-powered CRM for sales teams — leads, deals, finance, and insights.",
  icons: {
    icon: "/favicon.ico",
  },
};

/** Automatic adaptive UI — viewport drives CSS breakpoints (no manual desktop/mobile mode) */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className={`${inter.variable} font-sans antialiased bg-background text-foreground min-h-full min-h-dvh tracking-tight`}
      >
        <AppThemeProvider>
          <AuthProvider>
            <ThemeSync>
              {children}
              <ThemeAwareToaster />
            </ThemeSync>
          </AuthProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
