# Build both HiveFund contracts (GNU toolchain on Windows: the ABI step is skipped with --no-abi).
$ErrorActionPreference = "Stop"
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\mingw64\bin;$env:Path"
Push-Location (Join-Path $PSScriptRoot "..\contracts")
try {
  foreach ($crate in @("bounty-hub", "hive-token")) {
    cargo near build non-reproducible-wasm --no-abi --manifest-path "$crate/Cargo.toml"
    if ($LASTEXITCODE -ne 0) { throw "build failed: $crate" }
  }
  Get-Item target/near/bounty_hub/bounty_hub.wasm, target/near/hive_token/hive_token.wasm |
    Select-Object Name, Length | Format-Table -AutoSize
} finally { Pop-Location }
