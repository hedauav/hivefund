"use client";

// Wallet session via @hot-labs/near-connect (browser only; loaded with ssr:false).
// Pattern follows the create-near-app next-app template (docs/research/offchain-web.md §3.2).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { NearConnector, type EventMap, type NearWalletBase } from "@hot-labs/near-connect";

export interface CallParams {
  contractId: string;
  method: string;
  args?: object;
  /** gas units as a string, default 30 TGas */
  gas?: string;
  /** yoctoNEAR deposit as a string */
  deposit?: string;
}

export interface WalletCtx {
  ready: boolean;
  network: "testnet" | "mainnet";
  accountId: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Signs and sends a real transaction; resolves with its hash. */
  call: (p: CallParams) => Promise<{ txHash: string }>;
}

export const WalletContext = createContext<WalletCtx | null>(null);

export function NearProvider({ children, network = "testnet" }: PropsWithChildren<{ network?: "testnet" | "mainnet" }>) {
  const connector = useMemo(
    () =>
      new NearConnector({
        network,
        // Only offer wallets that can sign and send on this network.
        features: { signAndSendTransaction: true, [network]: true },
        providers: { mainnet: ["https://free.rpc.fastnear.com"], testnet: ["https://test.rpc.fastnear.com"] },
      }),
    [network],
  );
  const [wallet, setWallet] = useState<NearWalletBase>();
  const [accountId, setAccountId] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    connector
      .getConnectedWallet()
      .then((c) => {
        if (!cancelled && c) {
          setWallet(c.wallet);
          setAccountId(c.accounts[0]?.accountId ?? "");
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setReady(true));
    const onIn = (p: EventMap["wallet:signIn"]) => {
      setWallet(p.wallet);
      setAccountId(p.accounts[0]?.accountId ?? "");
    };
    const onOut = () => {
      setWallet(undefined);
      setAccountId("");
    };
    connector.on("wallet:signIn", onIn);
    connector.on("wallet:signOut", onOut);
    return () => {
      cancelled = true;
      connector.off("wallet:signIn", onIn);
      connector.off("wallet:signOut", onOut);
    };
  }, [connector]);

  const signIn = useCallback(async () => {
    const w = await connector.connect();
    setWallet(w);
    setAccountId((await w.getAccounts())[0]?.accountId ?? "");
  }, [connector]);

  const signOut = useCallback(async () => {
    if (wallet) await connector.disconnect(wallet);
    setWallet(undefined);
    setAccountId("");
  }, [connector, wallet]);

  const call = useCallback(
    async ({ contractId, method, args = {}, gas = "30000000000000", deposit = "0" }: CallParams) => {
      if (!wallet) throw new Error("Connect a wallet first");
      const outcome = await wallet.signAndSendTransaction({
        network,
        receiverId: contractId,
        actions: [{ type: "FunctionCall", params: { methodName: method, args, gas, deposit } }],
      });
      const status = outcome.status as { Failure?: unknown } | string;
      if (typeof status === "object" && status && "Failure" in status) {
        throw new Error(`transaction failed: ${JSON.stringify(status.Failure)}`);
      }
      return { txHash: outcome.transaction.hash as string };
    },
    [wallet, network],
  );

  const value = useMemo<WalletCtx>(() => ({ ready, network, accountId, signIn, signOut, call }), [ready, network, accountId, signIn, signOut, call]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletCtx(): WalletCtx | null {
  return useContext(WalletContext);
}
