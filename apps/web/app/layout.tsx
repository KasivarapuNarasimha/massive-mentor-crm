import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "sonner";

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
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-zinc-950 h-full">
      <body
        className={`${inter.variable} font-sans antialiased bg-zinc-950 text-white min-h-full min-h-dvh tracking-tight`}
      >
        <AuthProvider>{children}</AuthProvider>
        <Toaster
          position="top-center"
          richColors
          closeButton
          theme="dark"
          className="toaster group"
          toastOptions={{
            classNames: {
              toast: "group toast group-[.toaster]:bg-zinc-900 group-[.toaster]:text-zinc-200 group-[.toaster]:border-zinc-800 group-[.toaster]:shadow-lg",
              description: "group-[.toast]:text-zinc-400",
              actionButton: "group-[.toast]:bg-white group-[.toast]:text-zinc-950",
              cancelButton: "group-[.toast]:bg-zinc-800 group-[.toast]:text-zinc-200",
              error: "group-[.toaster]:bg-red-950 group-[.toaster]:border-red-900 group-[.toaster]:text-red-400",
              success: "group-[.toaster]:bg-emerald-950 group-[.toaster]:border-emerald-900 group-[.toaster]:text-emerald-400",
            },
          }}
        />
      </body>
    </html>
  );
}
