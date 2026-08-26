import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { PreferencesProvider } from "@/components/preferences-provider";

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
  title: "RAG StepLab",
  description: "A local learning interface for understanding RAG systems.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <PreferencesProvider>
          <AuthProvider>
            <DocumentPipelineProvider>
              <AppShell>{children}</AppShell>
            </DocumentPipelineProvider>
          </AuthProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
