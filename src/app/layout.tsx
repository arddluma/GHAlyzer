import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://ghalyzer.vercel.app";

const databuddyClientId = process.env.NEXT_PUBLIC_DATABUDDY_CLIENT_ID;

const title = "GHAlyzer — GitHub Actions analytics & slow CI pipeline finder";
const description =
  "Find slow, flaky, and regressing GitHub Actions workflows across every repo in your user or org. Avg, p95, max duration, failure rate, daily trend, and actionable insights — no database, fully stateless.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · GHAlyzer",
  },
  description,
  applicationName: "GHAlyzer",
  keywords: [
    "GitHub Actions",
    "CI analytics",
    "CI/CD performance",
    "pipeline duration",
    "workflow analytics",
    "slow CI",
    "flaky workflows",
    "DevOps metrics",
    "GHAlyzer",
  ],
  authors: [{ name: "GHAlyzer" }],
  creator: "GHAlyzer",
  publisher: "GHAlyzer",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: ["/logo.png"],
    apple: ["/logo.png"],
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "GHAlyzer",
    title,
    description,
    images: [
      {
        url: "/logo.png",
        width: 1024,
        height: 1024,
        alt: "GHAlyzer — GitHub Actions analytics",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "GHAlyzer",
    description,
    url: siteUrl,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    image: `${siteUrl}/logo.png`,
  };
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        {children}
        {databuddyClientId && (
          <Script
            src="https://cdn.databuddy.cc/databuddy.js"
            strategy="afterInteractive"
            crossOrigin="anonymous"
            data-client-id={databuddyClientId}
            data-track-attributes="true"
            data-track-outgoing-links="true"
            data-track-interactions="true"
            data-track-web-vitals="true"
            data-track-errors="true"
          />
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
