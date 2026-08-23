import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { PreferencesProvider } from "@/components/preferences-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "RAG StepLab",
  description: "A local learning interface for understanding RAG systems.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
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
