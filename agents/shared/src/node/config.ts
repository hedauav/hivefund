// Env + deployment config loading (Node only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeploymentConfig } from "../types.ts";

let cachedRoot: string | null = null;

/** Repo root: the nearest ancestor of this file that has a package.json with "workspaces". */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, "utf8")).workspaces) return (cachedRoot = dir);
      } catch {
        /* keep walking */
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return (cachedRoot = process.cwd());
}

/** Parse a dotenv file (KEY=VALUE, # comments, optional quotes). */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

let envLoaded = false;
/** Load <repo>/.env.local then <repo>/.env into process.env; never overrides variables already set. */
export function loadEnv(force = false): void {
  if (envLoaded && !force) return;
  envLoaded = true;
  for (const name of [".env.local", ".env"]) {
    const p = path.join(repoRoot(), name);
    if (!fs.existsSync(p)) continue;
    for (const [k, v] of Object.entries(parseDotenv(fs.readFileSync(p, "utf8")))) {
      if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
    }
  }
}

export type Mode = "mock" | "testnet";

/** HIVEFUND_MODE; default "testnet" (mock is opt-in, for tests/offline dev only). */
export function getMode(): Mode {
  loadEnv();
  return process.env.HIVEFUND_MODE === "mock" ? "mock" : "testnet";
}

export function dataDir(): string {
  loadEnv();
  const d = process.env.HIVEFUND_DATA_DIR || "./data";
  return path.isAbsolute(d) ? d : path.join(repoRoot(), d);
}

export function deploymentPath(): string {
  return path.join(repoRoot(), "config", "deployment.testnet.json");
}

/** config/deployment.testnet.json, or null if the contracts are not deployed yet. */
export function loadDeployment(p: string = deploymentPath()): DeploymentConfig | null {
  if (!fs.existsSync(p)) return null;
  const cfg = JSON.parse(fs.readFileSync(p, "utf8")) as DeploymentConfig;
  if (!cfg.hub || !cfg.token) return null;
  return cfg;
}

/** Required env var (after loadEnv); throws a clear message if missing. */
export function requireEnv(name: string): string {
  loadEnv();
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (see .env.example; secrets live in .env.local)`);
  return v;
}
