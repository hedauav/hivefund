"use client";

import dynamic from "next/dynamic";
import type { PropsWithChildren } from "react";
import { DataProvider } from "./data-provider";
import { ThemeProvider } from "./theme-provider";

// Wallet libraries need browser APIs: initialise after hydration.
const NearProvider = dynamic(() => import("./near-provider").then((m) => m.NearProvider), {
  ssr: false,
  loading: () => null,
});

const NETWORK = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <DataProvider>
        <NearProvider network={NETWORK}>{children}</NearProvider>
      </DataProvider>
    </ThemeProvider>
  );
}
