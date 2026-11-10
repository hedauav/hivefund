# Stream D notes: web dashboard (`/web`)

Next.js 16.4 App Router · React 19 · Tailwind v4 · recharts 3 · `@hot-labs/near-connect` 0.12 · `near-api-js` 7.4.

```
npm -w web run dev       # http://localhost:3000
npm -w web run build     # production build (passes)
npm -w web run lint | typecheck
npm -w web run fixture   # regenerate web/fixtures (sample data)
```

## Data source: live first

| Condition | Mode | What renders |
|---|---|---|
| `config/deployment.testnet.json` has `hub`, or `NEXT_PUBLIC_HUB_CONTRACT` is set | **live** | The browser calls the bounty-hub views over JSON-RPC (`rpcUrl`, default `https://test.rpc.fastnear.com`) every 5 s: `get_config`, `get_bounties`, `get_bids` per bounty, `get_treasury`, `get_reputation`, `get_activity_log`, `get_supply_history`, plus `ft_total_supply` on the token. |
| no deployment | **sample** | `data/sample/chain-snapshot.json` if present, else `web/fixtures/`. A prominent **"SAMPLE DATA — NOT LIVE"** banner is shown and no explorer links are rendered (sample hashes are not real). |

There is no switch that shows sample data while a deployment exists.

Off-chain objects (specs, deliverables, reports, selection rationales), strategy logs and the tx log are served by API routes from:
- live: `$HIVEFUND_DATA_DIR` (default `<repo>/data`), then `web/public/offchain/` (exported snapshot for hosting)
- sample: `data/sample/`, then `web/fixtures/`

### Files the dashboard expects (Stream B: `store.ts` / demo `--mode mock` export)
```
<dir>/offchain/<sha256>.json        # exactly canonicalize(obj)
<dir>/index.jsonl                   # {hash, kind, bounty_id?, round?, actor, ts_ms?} per line
<dir>/strategy/<worker-account>.jsonl  # StrategyChange per line
<dir>/tx.jsonl                      # {ts, actor, method, args, txHash} per line
<dir>/chain-state.json              # SAMPLE ONLY: Stream B readChainState() output (or chain-snapshot.json = web ChainSnapshot)
```
`ChainSnapshot = { source, generated_ms, config: HubConfig, bounties, bids, treasury, reputation: WorkerView[], activity, supply }`, i.e. the hub views' outputs in one object. Also accepted: `snapshot.json` or `chain.json`.

**Tx linking:** an item gets a nearblocks tx link when `tx.jsonl` has a matching row. Matching uses `method` plus `args`: `post_bounty` by `bounty_id` (or `title`), `place_bid` by `actor` + `bounty_id` + `price_yocto`, `select_winner`/`reject_bid` by `bounty_id` + `bid_id`, `submit_work` by `bounty_id` + `deliverable_hash`, and `verify_bounty` by `bounty_id` + `check_results_hash`. Include `bounty_id` in `post_bounty` args (log the returned id). Every activity-log entry also links to its block (`/blocks/<height>`), so on-chain events are verifiable even without the tx log.

## API routes
| Route | Returns |
|---|---|
| `/api/config` | `{mode, network, rpcUrl, hub, token, explorer, dataSource}` |
| `/api/snapshot` | The sample ChainSnapshot. Returns 409 in live mode. |
| `/api/offchain/[hash]` | `{hash, verified, object}`. The server re-hashes the stored object (409 on mismatch, 404 if missing), and the client re-hashes again before showing ✓. |
| `/api/offchain?bounty_id=&kind=` | Index rows |
| `/api/strategy`, `/api/strategy/[worker]` | Strategy-change logs |
| `/api/tx` | Tx log |

## Real verification in the browser
- **Bid signatures (live):** checked with `verifyBid(signed_payload, signature, signing_pk)` from `get_reputation`, plus a check that the payload names this hub. Sample mode shows the coordinator's recorded verdict instead.
- **Reports, specs and rationales:** sha256(canonical JSON) is recomputed and compared with the on-chain `check_results_hash` / `spec_hash`.
- **Mints:** recomputed with `mintAmount(winning price, score, mint_rate)`. `ft_total_supply` is compared with the hub's `total_minted`.

## Wallet
`NearConnector({ network: "testnet", features: { signAndSendTransaction: true, testnet: true } })` is loaded client-side only (`dynamic(..., { ssr: false })`). "Fund the treasury" signs a real `fund_treasury` FunctionCall (30 TGas plus the deposit) and links the resulting tx. It is disabled until a deployment exists. Wallet testnet support varies; HOT is mainnet-only per its manifest.

## Panels
`/` shows: stats, the bounty board, treasury (+ fund), bid board and verification for the featured or clicked bounty, the HIVE panel (supply chart and per-mint formula trace), workers (table, margin-over-time chart, strategy reasons), reputation, and the activity feed. `/bounty/[id]` shows: the on-chain record, the acceptance spec, the bid board for all rounds, verification for all rounds, and the activity log filtered to that bounty.

## Hosting note
On Vercel, API routes read `web/public/offchain/` (Stream B's `exportSnapshot`). `next.config.ts` traces `fixtures/`, `data/sample/` and `config/*.json` into the functions.

## Redesign + Swarm Arena (2026-11-10)
- **Look:** printed-matter palette defined as CSS tokens in `web/src/app/globals.css`: paper `#EFE8DA`, ink `#1E1B16`, brick (failures), moss (passes), ochre (HIVE), denim (links). Dark mode is soil brown with the same hues. Text pairs are noted in the file as ≥4.5:1.
  - Fonts: Public Sans (UI), Bricolage Grotesque (headings), IBM Plex Mono (hashes), Pixelify Sans (arena only).
  - Surfaces use 1.5px ink rules, 2px radius and offset solid shadows.
  - Tables use the `.ledger` class with tabular figures.
  - Section headers are numbered tags (01–09). Empty states say what is missing and what will fill it.
- **Order on `/`:** arena → totals strip → bounties + bids (7/5 split) → verification → HIVE → workers → treasury + reputation (5/7) → ledger.
- **Arena code** (`web/src/components/arena/`, about 15 KB of source):
  - `model.ts`: a pure reducer over `get_activity_log` entries plus the strategy logs.
  - `sprites.tsx`: hand-placed 8×10 pixel figures.
  - `arena.tsx`: the player.
- **Arena behaviour:**
  - On first load, history is fast-forwarded and the last 14 events are replayed.
  - New events picked up by the 5 s poll are queued and animate as they arrive.
  - Controls: play/pause, 1×/2×/4× speed and replay.
  - The caption narrates the current event and links its block on nearblocks in live mode.
  - Motion is CSS `steps()` transitions. React only re-renders the arena once per event.
  - With `prefers-reduced-motion`, there is no animation; a numbered list of the same events is shown instead.
- **`HIVEFUND_FORCE_SAMPLE=1`:** a local design/testing switch that shows sample data even when a deployment exists. The SAMPLE DATA banner is still shown.

## Recorded testnet run (data/testnet-run/)
- **Read order for off-chain records** (merged by hash in `/api/offchain`, `/api/offchain/[hash]`, `/api/strategy` and `/api/tx`):
  1. `$HIVEFUND_DATA_DIR`, default `<repo>/data` (live agent output on this machine)
  2. the recorded testnet run
  3. `web/public/offchain/`
- **Chain views** (bounties, bids, treasury, reputation, activity, supply) always come from RPC in the browser. The recorded run never replaces them.
- **Hub check:** the recorded run is used only when its `manifest.hub` equals the deployed hub. It is labelled "recorded testnet run" in the live status bar, and the SAMPLE banner is never shown for it.
- **Hosting (robust option chosen):** `npm -w web run build` runs `prebuild`, i.e. `tsx scripts/bundle-recorded.ts`.
  - The script re-hashes every object and writes `web/src/generated/recorded-run.json`: the manifest, `config/deployment.testnet.json`, index, strategy, tx and the offchain objects.
  - `lib/server/data.ts` imports that file statically, so it ships inside the server bundle on any host (Vercel functions included) with no runtime filesystem access.
  - The generated file is committed so typecheck and lint work on a fresh clone. Rebuilding refreshes it.
  - Run `npm -w web run bundle:recorded` after re-exporting the run.
- **Deployment fallback:** if `config/deployment.testnet.json` is not on the function filesystem, the bundled copy is used, so hosted builds still default to live mode.
- **Tx links:** rows with `ok: false` (failed transactions) are ignored when choosing which tx to link. Rows without a `txHash` cannot be linked.
- **Ledger and captions:** raw contract amounts (`… yocto`, `… HIVE-raw/HIVE-yocto`, `… ms`) are rendered in NEAR, HIVE and minutes by `humanizeDetail()`.

## Procurement bounties (UI)

- Detection: a bounty is procurement when its spec (loaded by hash, re-hashed in the browser) has `procurement`. `useProcurement()` / `useEvidenceByReport()` in `web/src/hooks/use-procurement.ts` share the `use-offchain` cache via `loadOffchain()`.
- Spec panel shows the purchase request (product budget USD, workload, cost formula, hard requirements, tolerance, delivery check). The NEAR budget is labelled "Bounty reward" for these specs.
- Verification panel: for reports with `procurement`, shows the worker proposal (deliverable data: item, quoted price, cost, catalog read time, alternatives, justification, generator) and the live-catalog evidence table (found, quoted vs live price, live cost vs budget, each requirement, delivery call). Old reports render unchanged.
- Boards: a small crate "procurement" tag on bounty rows and the bid board title.
- Arena: procurement cards carry a crate icon; Verification captions use the report linked by `checks <hash>` in the activity detail, e.g. "re-fetched the live price of X: $0.55 ≤ budget $3 ✓; quote matches ✓; requirements ✓".
- `/preview/procurement`: a FIXTURE story (clearly bannered, illustrative values) for design work before a real run. Available in `next dev`; 404 in production builds unless `NEXT_PUBLIC_SHOW_PREVIEW=1`. Real procurement bounties render from on-chain hashes on `/` and `/bounty/[id]`.
