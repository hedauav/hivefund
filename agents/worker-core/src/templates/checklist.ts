// Fallback (no-LLM) generator for the "hivefund:subaccount-checklist-v1" bounty.
// Thoroughness depends on quality: low ships 3 items (fails the >= 5 items schema), medium ships a
// short checklist without commands, high ships a full checklist with concrete commands and references.
import type { Quality } from "../pricing.ts";
import type { TemplateOutput } from "./index.ts";

interface Item {
  title: string;
  rationale: string;
}

const HIGH_ITEMS: Item[] = [
  {
    title: "Give every agent its own sub-account",
    rationale:
      "Sub-account creation (agent.team.testnet) isolates balances and keys so one compromised agent cannot spend another agent's funds. Command: near account create-account fund-myself agent.team.testnet '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as team.testnet network-config testnet sign-with-keychain send",
  },
  {
    title: "Use function-call access keys, never full-access keys, on agent hosts",
    rationale:
      "A function-call access key can only call the listed contract and cannot transfer NEAR or deploy code, which limits the blast radius. Command: near account add-key agent.team.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id hub.team.testnet --function-names 'place_bid, submit_work' autogenerate-new-keypair save-to-keychain network-config testnet sign-with-keychain send",
  },
  {
    title: "Restrict method names on every function-call key",
    rationale:
      "Method restrictions mean a leaked worker key cannot call verify_bounty or select_winner; list only the methods the role needs and test that other calls fail.",
  },
  {
    title: "Set a gas allowance on each key",
    rationale:
      "Allowance limits cap how much gas a stolen key can burn. The allowance cannot be raised later, so rotate the key when it runs out instead of granting an unlimited allowance.",
  },
  {
    title: "Remove full-access keys after setup",
    rationale:
      "Removing full-access keys from agent sub-accounts means the only remaining key is the restricted one. Command: near account delete-keys agent.team.testnet public-keys ed25519:<pk> network-config testnet sign-with-keychain send. Keep recovery on the parent account.",
  },
  {
    title: "Rotate keys on a schedule and after incidents",
    rationale:
      "Key rotation: add the new function-call key with near-api-js account.addFunctionCallAccessKey(), switch the agent over, then delete the old key so a leaked key has a short lifetime.",
  },
  {
    title: "Keep secrets out of the repository",
    rationale:
      "Load private keys from environment variables (.env.local, gitignored) and ship only .env.example; judges and attackers both scan git history.",
  },
  {
    title: "Plan sub-account deletion and fund recovery",
    rationale:
      "Sub-account deletion with a beneficiary returns leftover NEAR to the parent: near account delete-account agent.team.testnet beneficiary team.testnet network-config testnet sign-with-keychain send.",
  },
];

const MEDIUM_ITEMS: Item[] = [
  { title: "One sub-account per agent", rationale: "Separate accounts keep each agent's funds and keys isolated from the others." },
  { title: "Use function-call keys", rationale: "Restricted keys cannot transfer tokens, so a leaked key does less damage." },
  { title: "Limit callable methods", rationale: "Only allow the methods the agent actually needs to call on the contract." },
  { title: "Set an allowance", rationale: "An allowance caps how much gas the key can spend before it stops working." },
  { title: "Keep keys out of git", rationale: "Store keys in environment variables and never commit them to the repository." },
];

const LOW_ITEMS: Item[] = [
  { title: "Use sub-accounts", rationale: "Each agent should have its own account for safety." },
  { title: "Use limited keys", rationale: "Limited keys are safer than full access keys." },
  { title: "Protect secrets", rationale: "Do not share your private keys with anyone." },
];

function numbered(items: Item[]): string {
  return items.map((it, i) => `${i + 1}. ${it.title} - ${it.rationale}`).join("\n");
}

export function checklistTemplate(quality: Quality): TemplateOutput {
  if (quality === "high") {
    return {
      sections: {
        summary:
          "Autonomous agents should hold the least privilege possible: one sub-account each, a function-call access key with method restrictions and an allowance, no full-access keys on the agent host, and a key rotation and deletion plan. Each item below names the risk it mitigates and a concrete near-cli-rs command or near-api-js call.",
        checklist: numbered(HIGH_ITEMS),
        references:
          "Official NEAR documentation:\nhttps://docs.near.org/protocol/accounts-contracts/access-keys\nhttps://docs.near.org/tools/cli\nhttps://docs.near.org/tools/near-api\nhttps://docs.near.org/smart-contracts/security/checklist",
      },
      data: { items: HIGH_ITEMS },
    };
  }
  if (quality === "medium") {
    return {
      sections: {
        summary: "Basic security practices for agents that run on NEAR accounts.",
        checklist: numbered(MEDIUM_ITEMS),
        references: "https://docs.near.org",
      },
      data: { items: MEDIUM_ITEMS },
    };
  }
  return {
    sections: { summary: "Keep agents safe.", checklist: numbered(LOW_ITEMS), references: "NEAR docs" },
    data: { items: LOW_ITEMS },
  };
}
