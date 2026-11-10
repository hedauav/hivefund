// nearblocks links. Only rendered as links in live mode: sample data has no real
// transactions or accounts behind it.
export interface Explorer {
  enabled: boolean;
  tx: (hash: string) => string;
  account: (id: string) => string;
  block: (height: number) => string;
}

export function makeExplorer(base: string, enabled: boolean): Explorer {
  const b = base.replace(/\/$/, "");
  return {
    enabled,
    tx: (h) => `${b}/txns/${h}`,
    account: (id) => `${b}/address/${id}`,
    block: (n) => `${b}/blocks/${n}`,
  };
}
