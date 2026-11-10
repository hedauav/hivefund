#!/usr/bin/env bash
# Build both HiveFund contracts (GNU toolchain on Windows: the ABI step is skipped with --no-abi).
set -euo pipefail
cd "$(dirname "$0")/../contracts"
for crate in bounty-hub hive-token; do
  cargo near build non-reproducible-wasm --no-abi --manifest-path "$crate/Cargo.toml"
done
ls -l target/near/bounty_hub/bounty_hub.wasm target/near/hive_token/hive_token.wasm
