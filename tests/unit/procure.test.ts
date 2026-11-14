import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpec } from "@hivefund/shared";
import { buildProcurementSpec, parseProcureArgs, procureMain, requirementsFromArgs } from "@hivefund/coordinator";

const base = ["--budget", "2", "--task", "summarise long support tickets"];

test("procure args: parses budget, task, needs, context and defaults", () => {
  const a = parseProcureArgs([...base, "--need", "Tools, structured-outputs ,vision", "--min-context", "128000"]);
  assert.equal(a.budgetUsd, 2);
  assert.equal(a.mode, "testnet");
  assert.equal(a.inputMtok, 3);
  assert.equal(a.outputMtok, 1);
  assert.equal(a.rewardNear, "0.03");
  assert.deepEqual(a.needs, ["tools", "structured-outputs", "vision"]);
  assert.deepEqual(requirementsFromArgs(a), {
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    supported_features: ["tools", "structured_outputs"],
    min_context_length: 128000,
  });
});

test("procure args: unsupported needs and bad numbers are rejected, never ignored", () => {
  assert.throws(() => parseProcureArgs([...base, "--need", "tools,teleport"]), /unsupported --need value\(s\): teleport/);
  assert.throws(() => parseProcureArgs(["--task", "summarise long support tickets"]), /--budget is required/);
  assert.throws(() => parseProcureArgs([...base.slice(0, 2), "--task", "x"]), /--task is required/);
  assert.throws(() => parseProcureArgs(["--budget", "-1", "--task", "summarise long support tickets"]), /positive number/);
  assert.throws(() => parseProcureArgs([...base, "--mode", "mainnet"]), /--mode/);
});

test("procure spec: valid procurement BountySpec with the user's budget and reward", () => {
  const spec = buildProcurementSpec(parseProcureArgs([...base, "--need", "json", "--reward", "0.02", "--input-mtok", "5"]));
  assert.deepEqual(validateSpec(spec), []);
  assert.equal(spec.procurement!.product_budget_usd, 2);
  assert.deepEqual(spec.procurement!.workload, { input_mtok: 5, output_mtok: 1 });
  assert.deepEqual(spec.procurement!.requirements.supported_features, ["json_mode"]);
  assert.equal(spec.budget_yocto, "20000000000000000000000");
  assert.match(spec.description, /summarise long support tickets/);
  assert.equal(spec.min_tier, 1);
});

test("procure e2e (mock): request is posted, a worker proposes, the verifier checks and the bounty completes", async () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...x: unknown[]) => void lines.push(x.join(" "));
  try {
    const code = await procureMain([...base, "--need", "tools,structured-outputs", "--min-context", "128000", "--mode", "mock"]);
    assert.equal(code, 0);
  } finally {
    console.log = orig;
  }
  const out = lines.join("\n");
  assert.match(out, /Procurement result \(mock/);
  assert.match(out, /Bounty {2}: #\d+ — Completed/);
  assert.match(out, /price: quoted .* ✓/);
  assert.match(out, /VERDICT: PASS/);
});
