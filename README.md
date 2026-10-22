# Guardia

**Real-time scam & anomaly detector for agent-to-agent money flows on NEAR.**

AI Security for the Agent Economy — built for the [NEAR Hackathon 2026](https://nearhackathon.com).

> Give AI agents money without giving them the keys to everything.

## Vision

Guardia is an on-chain policy engine + watcher that monitors transfers between AI agents, scores them for scam / anomaly risk, and can freeze suspicious flows before the money leaves.

### Core features (MVP)
- Registry of protected agent accounts
- Single-transfer limit and frozen flag
- `check_transfer` view used by the watcher
- NEP-297 events for register / freeze / unfreeze / policy updates
- TypeScript watcher with a local demo of the same rules

### Tracks
- Primary: **AI Security & Defense**
- Also relevant: Agent Economy, Autonomous Business

## Project structure

```
guardia/
├── contracts/guardia/   # Rust policy engine
├── watcher/             # TypeScript watcher + local demo
└── README.md
```

## Contract

### Build

```bash
cd contracts/guardia
cargo near build non-reproducible-wasm
```

WASM lands at `target/near/guardia.wasm`.

### Test

```bash
cd contracts/guardia
cargo test
```

### Deploy to testnet

1. Create a testnet account (for example with [MyNearWallet testnet](https://testnet.mynearwallet.com)) and make sure `near-cli-rs` can sign for it (`near account import-account` using the seed phrase, or create the account with the CLI).
2. From `contracts/guardia`, deploy and init in one step. Replace both account ids with yours (owner is usually the same account you deploy to):

```bash
cargo near deploy YOUR_ACCOUNT.testnet \
  with-init-call new \
  json-args '{"owner_id":"YOUR_ACCOUNT.testnet"}' \
  prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' \
  network-config testnet \
  sign-with-keychain \
  send
```

If the CLI asks you to pick a key, choose the full-access key for `YOUR_ACCOUNT.testnet`.

3. Register an agent (from any shell with near-cli-rs):

```bash
near contract call-function as-transaction YOUR_ACCOUNT.testnet register_agent \
  json-args '{"agent_id":"agent.YOUR_ACCOUNT.testnet"}' \
  prepaid-gas '30.0 Tgas' \
  attached-deposit '0 NEAR' \
  sign-as YOUR_ACCOUNT.testnet \
  network-config testnet \
  sign-with-keychain \
  send
```

4. Ask the contract whether a 1 NEAR transfer is allowed:

```bash
near contract call-function as-read-only YOUR_ACCOUNT.testnet check_transfer \
  json-args '{"agent_id":"agent.YOUR_ACCOUNT.testnet","amount":"1000000000000000000000000"}' \
  network-config testnet \
  now
```

## Watcher

```bash
cd watcher
npm install
npm run demo
```

See [watcher/README.md](watcher/README.md) for the live RPC mode.

## Status

Contract builds. Unit tests and a local watcher demo are in the repo. Testnet deploy is the next command you run locally (keys stay on your machine).

## License

MIT
