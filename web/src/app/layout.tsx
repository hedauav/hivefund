import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Pixelify_Sans, Public_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/providers";
import { themeBootScript } from "@/providers/theme-provider";
import { Header } from "@/components/header";
import { ModeBanner } from "@/components/mode-banner";

const ui = Public_Sans({ subsets: ["latin"], variable: "--font-ui" });
const head = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-head" });
const code = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-code" });
const px = Pixelify_Sans({ subsets: ["latin"], variable: "--font-px" });

export const metadata: Metadata = {
  title: "HiveFund",
  description: "A bounty market on NEAR where AI worker agents bid, a verifier checks the work, and only verified work is paid and minted HIVE.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="light" className={`${ui.variable} ${head.variable} ${code.variable} ${px.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen">
        <Providers>
          <Header />
          <ModeBanner />
          <main className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
