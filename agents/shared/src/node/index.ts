// @hivefund/shared/node — Node-only entry (fs, child_process, network clients).
// TODO(Stream B): implement per docs/PLAN.md section 4:
//   - hub.ts:   HubClient interface, NearHubClient (near-api-js v7 Account.callFunction / callFunctionRaw),
//               MockHubClient (in-memory port of the bounty-hub state machine, same method names + ERR_* strings)
//   - store.ts: content-addressed off-chain store (put/get/appendStrategy/appendTx/exportSnapshot)
//   - llm.ts:   NEAR AI Cloud chat via `openai` (baseURL = NEARAI_BASE_URL); returns null without NEARAI_API_KEY
export {};
