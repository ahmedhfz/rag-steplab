import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { PreferencesProvider } from "@/components/preferences-provider";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "RAG StepLab";
const SITE_DESCRIPTION = "Explore each RAG stage, inspect source evidence, and compare real pipeline results in a hands-on learning lab.";

/** Absolute base for OG/Twitter URLs; an unset or invalid override falls back to production. */
function siteUrl() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://rag-steplab.vercel.app");
  } catch {
    return new URL("https://rag-steplab.vercel.app");
  }
}

// The share image comes from app/opengraph-image.tsx; Twitter inherits title, description and image from openGraph.
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    alternateLocale: ["tr_TR"],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script data-theme-bootstrap dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
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
