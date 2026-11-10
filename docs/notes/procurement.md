# Procurement bounties: interface notes

Status: the interface is fixed. The core implementation (shared helpers, workers, verifier, demo) is in progress. The web and docs agents should build against this file.

## Use case

"I give a budget and requirements. Agents compete to find the best real product under that price. The verifier checks it before anyone is paid."

- Workers **recommend** an item. Nobody checks out or pays the vendor.
- The bounty reward is still NEAR (`budget_yocto`, paid by the hub on a pass).
- The product budget is in USD, the catalog's currency.

## Catalog: NEAR AI Cloud model list

- URL: `GET https://cloud-api.near.ai/v1/models`. Public, no API key.
- Verified live on 2026-11-11: HTTP 200 with 64 models.
- Each entry has:
  - `id`, `name`
  - `pricing.input` / `pricing.output`: USD per 1M tokens, as numbers
  - `context_length`
  - `supported_features`, e.g. `tools`, `structured_outputs`, `json_mode`, `reasoning`
  - `input_modalities` / `output_modalities`

Why this catalog:
1. The data is real and priced, and anyone, the verifier included, can re-fetch it without a key at verification time.
2. It fits the story on NEAR: agents buying compute is the Agent Economy idea. The pick can also be *used*: the verifier makes one tiny real call to the chosen model (the `delivery` check).
3. The hard requirements can be checked by machine: features, context length and modalities are structured fields.

Rejected options:
- **Fake shops** (fakestoreapi, dummyjson): the data is not real.
- **Steam appdetails**: real, but the prices are per-region and the requirements are fuzzy.

Adapter id: `"nearai-models"`. Helpers live in `agents/shared/src/procurement.ts` and are exported from `@hivefund/shared`: `parseCatalog`, `workloadCost`, `checkRequirements`, `compliantOptions`, `priceMatches`, `itemSourceUrl`, `validateProcurement`, `liveCatalog`, and the type `CatalogSource`.

Prices are rounded to 6 decimals to remove float noise; the API returns values like `3.3000000000000003`.

## Spec: `BountySpec.procurement` (optional, backward compatible)

Fixtures live in `bounties/procurement/*.json`. That subfolder is **not** posted by the default `npm run demo`. To post them, run `npm run demo -- --bounties procurement`.

```jsonc
{
  "version": 1,
  "title": "Procure the best-value LLM for a NEAR dApp support agent",
  "description": "...",
  "deliverable_schema": { "$id": "hivefund:procurement-v1", ... },   // see Deliverable.data below
  "required_sections": ["summary", "comparison", "recommendation"],
  "test": null,
  "rubric": {
    "criteria": [
      { "id": "value", "description": "...", "weight": 0.5 },          // value for money vs the compliant options
      { "id": "fit", "description": "...", "weight": 0.3 },            // fit for the stated task beyond hard reqs
      { "id": "justification", "description": "...", "weight": 0.2 }   // clear, grounded comparison
    ],
    "pass_threshold": 70
  },
  "budget_yocto": "30000000000000000000000",   // 0.03 NEAR bounty reward
  "min_tier": 1,
  "deadline_minutes": 60,
  "procurement": {
    "catalog": "nearai-models",
    "catalog_url": "https://cloud-api.near.ai/v1/models",
    "currency": "USD",
    "product_budget_usd": 3.0,                       // max workload cost of the pick
    "workload": { "input_mtok": 3, "output_mtok": 1 },   // cost = input*3 + output*1 (USD)
    "requirements": {
      "supported_features": ["tools", "structured_outputs"],
      "min_context_length": 200000,
      "input_modalities": ["text"],
      "output_modalities": ["text"]
    },
    "price_tolerance_pct": 1,                        // quoted vs live price, each component, relative
    "delivery_check": true                           // verifier makes 1 tiny real call to the pick
  }
}
```

Formulas:
- `workloadCost = round6(pricing.input * workload.input_mtok + pricing.output * workload.output_mtok)`
- An item is **compliant** if every requirement passes and `workloadCost <= product_budget_usd`.

## Deliverable for a proposal

`sections`: `summary`, `comparison`, `recommendation`, all markdown strings.

`data` (JSON Schema `$id` `hivefund:procurement-v1`):

```jsonc
{
  "item_id": "openai/gpt-5-nano",                 // catalog id of the pick
  "source_url": "https://cloud-api.near.ai/v1/models#openai%2Fgpt-5-nano",
  "quoted_pricing": { "input": 0.05, "output": 0.4 },   // USD / 1M tokens as the worker read it
  "quoted_workload_cost_usd": 0.55,
  "catalog_fetched_at_ms": 1789000000000,          // when the worker read the catalog
  "considered_count": 64,                          // how many catalog entries the worker scanned
  "alternatives": [ { "item_id": "google/gemini-2.5-flash-lite", "workload_cost_usd": 0.7 } ],  // 0..10
  "justification": "..."
}
```

The usual `deliverable.generator` provenance applies: `{mode: "llm"|"template"|"failed", model}`. `template` occurs only in mock mode, where the choice is deterministic.

## What the verifier adds to `VerificationReport`

Check order for procurement specs:
1. `schema`
2. `sections`
3. `test` (skipped; procurement specs have no test)
4. **`catalog`**: re-fetch the live catalog; the item must exist, the quoted price must match the live price within tolerance, the live cost must be within budget, and every requirement must pass.
5. **`delivery`**: one tiny real call to the chosen model through NEAR AI with the verifier's key. It must return HTTP 200 with usage. It is `skipped` when `delivery_check` is false or there is no key (mock).
6. `rubric`: runs only if every non-skipped automated check passed. The LLM receives the live compliant options, so its value judgement is grounded.

`CheckId` is now `"schema" | "sections" | "test" | "catalog" | "delivery" | "rubric"`.

`passed` is unchanged: all automated checks pass AND rubric total ≥ threshold.

New optional field `report.procurement` (`ProcurementEvidence`, in `agents/shared/src/types.ts`). It is hash-locked with the report:

```ts
{
  catalog_url: string;
  fetched_at_ms: number;              // verifier's live fetch time
  catalog_size: number;
  item_id: string;
  found: boolean;
  quoted_pricing: { input: number; output: number } | null;
  live_pricing:   { input: number; output: number } | null;
  price_match: boolean;
  quoted_workload_cost_usd: number | null;
  live_workload_cost_usd: number | null;
  budget_usd: number;
  within_budget: boolean;
  requirement_checks: { requirement: string; expected: string; actual: string; passed: boolean }[];
  compliant_count: number;            // live compliant options under budget
  cheapest_compliant: { id: string; workload_cost_usd: number } | null;
  delivery: {
    model: string; ok: boolean; http_status: number | null;
    prompt_tokens: number | null; completion_tokens: number | null;
    cost_usd: number | null;          // tokens * live price
    details: string;
  } | null;
}
```

What the web should show (evidence table):
- item
- quoted vs live price, with a ✓ or ✗ for `price_match`
- live workload cost vs budget
- each `requirement_checks` row
- the compliant count and the cheapest compliant option
- the delivery call result and its cost

Old reports have no `procurement` field and must render as before.

## Workers: genuine differences

| Worker | How it scans the catalog | Who writes the quoted prices |
|---|---|---|
| cheap | Shallow: the LLM sees only the first 12 catalog entries, unfiltered, and picks the first acceptable one | The LLM; they are not re-checked |
| adaptive | The first 30 entries, pre-filtered by code to compliant ones | Filled from the catalog by code |
| quality | The whole catalog, pre-filtered to compliant ones, with costs computed | Filled from the catalog by code; the LLM compares value |
