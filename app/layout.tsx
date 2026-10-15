import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { PreferencesProvider } from "@/components/preferences-provider";
import { UiProvider } from "@/components/ui/ui-provider";
import { UI_COPY } from "@/lib/copy";
import { TITLE_TEMPLATE } from "@/lib/page-titles";
import { DEFAULT_LOCALE, LOCALE_BOOTSTRAP_SCRIPT, THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = UI_COPY.en.productName;
const SITE_DESCRIPTION = "An open-source learning lab that makes every step of a RAG pipeline visible on a real PDF.";
// Link-preview cards often show only the title, so it carries the login hero's tagline too.
const SHARE_TITLE = `${SITE_NAME}: ${UI_COPY.en.auth.hero.title}`;

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
  // Each page.tsx names itself (`pageMetadata`); the shell localizes it after hydration.
  title: { default: SITE_NAME, template: TITLE_TEMPLATE },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SHARE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    alternateLocale: ["tr_TR"],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Theme and locale bootstraps rewrite class/style/lang before hydration.
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        <script data-theme-bootstrap dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <script data-locale-bootstrap dangerouslySetInnerHTML={{ __html: LOCALE_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <PreferencesProvider>
          <UiProvider>
            <AuthProvider>
              <DocumentPipelineProvider>
                <AppShell>{children}</AppShell>
              </DocumentPipelineProvider>
            </AuthProvider>
          </UiProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
