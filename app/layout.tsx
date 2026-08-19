import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
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
          <DocumentPipelineProvider>
            <AppShell>{children}</AppShell>
          </DocumentPipelineProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
