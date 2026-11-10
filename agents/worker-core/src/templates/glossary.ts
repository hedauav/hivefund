// Fallback (no-LLM, simulation only) generator for the "hivefund:near-glossary-v1" starter bounty.
// low ships 8 terms (fails the >= 10 items schema), medium/high ship all 10.
import type { Quality } from "../pricing.ts";
import type { TemplateOutput } from "./index.ts";

const TERMS: [string, string][] = [
  ["account", "Your identity on NEAR. It holds your tokens and the keys that let you approve actions."],
  ["named account", "An account with a readable name such as alice.near instead of a long string of characters."],
  ["sub-account", "An account created under another one, like app.alice.near, often used to separate an app or agent from your main funds."],
  ["access key", "A key stored by your wallet that lets it approve actions for your account."],
  ["function-call key", "A limited key that can only call specific methods of one app and cannot send your tokens."],
  ["gas", "The small fee paid to the network for running a transaction."],
  ["storage staking", "NEAR set aside to pay for the data an account or app stores on the blockchain; it is returned when the data is deleted."],
  ["yoctoNEAR", "The smallest unit of NEAR: one NEAR is 10^24 yoctoNEAR."],
  ["testnet", "A practice version of NEAR where tokens have no real value, used for testing apps."],
  ["transaction hash", "A unique ID for a transaction that you can look up in an explorer to see what happened."],
];

export function glossaryTemplate(q: Quality): TemplateOutput {
  const terms = (q === "low" ? TERMS.slice(0, 8) : TERMS).map(([term, definition]) => ({ term, definition }));
  return {
    sections: {
      intro: "Plain-language definitions of common NEAR terms for new users (simulation template, no LLM).",
      glossary: terms.map((t) => `- **${t.term}**: ${t.definition}`).join("\n"),
    },
    data: { terms },
  };
}
