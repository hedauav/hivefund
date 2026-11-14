import { formatHive, formatNear } from "@hivefund/shared";


export const near = (yocto: string | bigint | null | undefined, frac = 3) =>
  yocto == null ? "—" : `${formatNear(yocto, frac)} Ⓝ`;

export const hive = (raw: string | bigint | null | undefined, frac = 3) =>
  raw == null ? "—" : `${formatHive(raw, frac)} HIVE`;

export function shortAccount(id: string | null | undefined): string {
  if (!id) return "—";
  const parts = id.split(".");
  if (parts.length >= 3) return parts[0];
  return id.length > 24 ? `${id.slice(0, 10)}…${id.slice(-8)}` : id;
}

export const shortHash = (h: string | null | undefined, n = 8) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 0) return `in ${dur(-s)}`;
  if (s < 5) return "just now";
  return `${dur(s)} ago`;
}

function dur(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const minutes = (ms: number) => `${Math.round(ms / 60000)}m`;

export const clock = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Tick formatter for a time axis. When the data spans more than one calendar day, a bare
 * "hh:mm" label can read as going backwards (e.g. 07:23 PM → 06:33 PM next day), so the
 * date is included whenever the range crosses a day boundary.
 */
export function axisTimeFormatter(ts: number[]): (t: number) => string {
  const days = new Set(ts.filter(Number.isFinite).map((t) => new Date(t).toDateString()));
  const multiDay = days.size > 1;
  return (t: number) =>
    new Date(t).toLocaleString(
      undefined,
      multiDay ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" },
    );
}

/** Worker role label derived from the sub-account name (cheap.*, quality.*, adaptive.*, forger.*). */
export function workerRole(id: string): string {
  return id.split(".")[0];
}

/**
 * Contract log lines carry raw integers ("paid x 27823500000000000000000 yocto",
 * "minted 251100000000000000 HIVE-raw", "eta 600000 ms"). Render them in human units.
 */
export function humanizeDetail(detail: string): string {
  return detail
    .replace(/\b(\d{10,}) yocto\b/g, (_, n: string) => `${formatNear(n, 4)} NEAR`)
    .replace(/\b(\d{10,}) HIVE(?:-raw|-yocto)?\b/g, (_, n: string) => `${formatHive(n, 4)} HIVE`)
    .replace(/\b(\d{4,}) ms\b/g, (_, n: string) => `${Math.round(Number(n) / 60000)}m`);
}
