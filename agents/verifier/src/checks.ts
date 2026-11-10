// Automated checks: (1) deliverable data against the spec's JSON Schema, (2) required sections present and
// non-empty, (3) the spec's executable acceptance test. The test runner only accepts `runner: "node"` with a
// file that resolves inside /bounties; the deliverable's code goes into a fresh temp dir and the test runs as
// `node <file> <tempdir>` (no shell, stripped env, timeout, output capped).
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Ajv } from "ajv";
import type { BountySpec, CheckResult, Deliverable } from "@hivefund/shared";

export type Clock = () => number;

const MAX_DETAILS = 600;
const MAX_CODE_FILES = 10;
const MAX_CODE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024;
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

function clip(s: string, n = MAX_DETAILS): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export function checkSchema(spec: BountySpec, d: Deliverable, now: Clock): CheckResult {
  const t0 = now();
  // A fresh Ajv per check keeps runs independent (and avoids "$id already exists" on recompiles).
  const { $id: _id, ...schema } = spec.deliverable_schema as Record<string, unknown>;
  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(d.data) as boolean;
    return {
      id: "schema",
      passed: ok,
      details: ok ? "data matches deliverable_schema" : clip(ajv.errorsText(validate.errors, { dataVar: "data" })),
      duration_ms: now() - t0,
    };
  } catch (e) {
    return { id: "schema", passed: false, details: clip(`invalid deliverable_schema: ${(e as Error).message}`), duration_ms: now() - t0 };
  }
}

export function checkSections(spec: BountySpec, d: Deliverable, now: Clock): CheckResult {
  const t0 = now();
  const sections = d.sections && typeof d.sections === "object" ? d.sections : {};
  const missing = spec.required_sections.filter((k) => {
    const v = (sections as Record<string, unknown>)[k];
    return typeof v !== "string" || v.trim() === "";
  });
  return {
    id: "sections",
    passed: missing.length === 0,
    details:
      missing.length === 0
        ? `all ${spec.required_sections.length} required sections present`
        : `missing or empty sections: ${missing.join(", ")}`,
    duration_ms: now() - t0,
  };
}

/** Resolve a spec test file strictly inside bountiesDir (after symlink resolution). Throws on violation. */
export async function resolveTestFile(file: string, bountiesDir: string): Promise<string> {
  if (typeof file !== "string" || file === "" || path.isAbsolute(file) || file.includes("\0")) {
    throw new Error(`test file must be a relative path inside /bounties: ${JSON.stringify(file)}`);
  }
  const root = await realpath(path.resolve(bountiesDir));
  const candidate = path.resolve(root, file);
  const rel = path.relative(root, candidate);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`test file escapes /bounties: ${file}`);
  }
  const real = await realpath(candidate);
  const relReal = path.relative(root, real);
  if (relReal === "" || relReal.startsWith("..") || path.isAbsolute(relReal)) {
    throw new Error(`test file resolves outside /bounties: ${file}`);
  }
  if (!(await stat(real)).isFile()) throw new Error(`test file is not a file: ${file}`);
  return real;
}

export async function checkTest(
  spec: BountySpec,
  d: Deliverable,
  bountiesDir: string,
  now: Clock,
): Promise<CheckResult> {
  const t0 = now();
  if (!spec.test) return { id: "test", passed: true, skipped: true, details: "spec has no test command", duration_ms: 0 };
  const fail = (details: string): CheckResult => ({ id: "test", passed: false, details: clip(details), duration_ms: now() - t0 });

  if (spec.test.runner !== "node") return fail(`refused: runner ${JSON.stringify(spec.test.runner)} is not allowed (only "node")`);
  let testFile: string;
  try {
    testFile = await resolveTestFile(spec.test.file, bountiesDir);
  } catch (e) {
    return fail(`refused: ${(e as Error).message}`);
  }

  const code = d.code && typeof d.code === "object" ? d.code : {};
  const entries = Object.entries(code);
  if (entries.length === 0) return fail("deliverable has no code files");
  if (entries.length > MAX_CODE_FILES) return fail(`too many code files (${entries.length} > ${MAX_CODE_FILES})`);
  let total = 0;
  for (const [name, src] of entries) {
    if (!FILE_NAME.test(name)) return fail(`refused: bad code file name ${JSON.stringify(name)}`);
    if (typeof src !== "string") return fail(`code file ${name} is not a string`);
    total += Buffer.byteLength(src);
  }
  if (total > MAX_CODE_BYTES) return fail(`code too large (${total} bytes)`);

  const timeoutMs = Math.min(60_000, Math.max(1_000, Number(spec.test.timeout_ms) || 10_000));
  const dir = await mkdtemp(path.join(os.tmpdir(), "hivefund-verify-"));
  try {
    for (const [name, src] of entries) await writeFile(path.join(dir, name), src as string, "utf8");
    const r = await runNode(testFile, [dir], dir, timeoutMs);
    // Replace the random temp path so identical inputs give identical reports (and hashes).
    const out = [r.stdout.trim(), r.stderr.trim()]
      .filter(Boolean)
      .join("\n")
      .split(dir)
      .join("<deliverable-dir>");
    if (r.timedOut) return fail(`timed out after ${timeoutMs} ms\n${out}`);
    return {
      id: "test",
      passed: r.code === 0,
      details: clip(`node ${spec.test.file} exited ${r.code}${out ? `\n${out}` : ""}`),
      duration_ms: now() - t0,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runNode(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Minimal environment: no API keys or NEAR keys reach deliverable code.
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (b: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += b.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(e.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
