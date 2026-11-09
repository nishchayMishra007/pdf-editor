import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local PDF Editor",
  description: "Canva-style local PDF text editor — no cloud, no accounts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ErrorBoundary>
          <AppShell>{children}</AppShell>
          <Toaster richColors position="bottom-right" />
        </ErrorBoundary>
      </body>
    </html>
  );
}
