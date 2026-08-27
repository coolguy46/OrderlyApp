import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { CanvasDataRefreshMonitor } from "@/components/providers/CanvasDataRefreshMonitor";
import { PlannerStalenessMonitor } from "@/components/planner/PlannerStalenessMonitor";
import { Toaster } from "sonner";
import { connection } from "next/server";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Orderly - Student Time Management Platform",
  description: "Keep tasks, exact deadlines, Canvas assignments, and your weekly schedule organized in one place.",
  icons: {
    icon: "/logo.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A request-scoped CSP nonce is attached by proxy.ts. Dynamic rendering is
  // required for Next.js to apply that nonce to framework and page scripts.
  await connection();
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className={`${inter.variable} ${jakarta.variable} font-sans antialiased`}>
        <ThemeProvider>
          <AuthGuard>
            <CanvasDataRefreshMonitor />
            <PlannerStalenessMonitor />
            {children}
          </AuthGuard>
          <Toaster richColors position="top-center" toastOptions={{ className: 'sm:!bottom-auto' }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
