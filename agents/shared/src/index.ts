// @hivefund/shared — isomorphic (browser + Node) entry. Never import node-only modules here.
export * from "./types.ts";
export * from "./canonical.ts";
export * from "./bid.ts";
export * from "./mint.ts";
// Stream B adds: spec.ts (BountySpec/Deliverable/VerificationReport validators), config.ts (deployment JSON + env).
