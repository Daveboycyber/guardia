# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. See [README.md](README.md) for the product
overview and [SECURITY.md](SECURITY.md) for the threat model.

## Project

Guardia is a spend-policy engine for AI agent accounts on NEAR testnet: an on-chain contract, a React dashboard,
and a TypeScript watcher that can auto-freeze agents.

| Item | Value |
|------|-------|
| Network | NEAR testnet |
| Contract | `skar.testnet` |
| Default agent | `agent.skar.testnet` |
| Owner | `skar.testnet` |
| Default limits | 10 NEAR single · 50 NEAR daily |

## Layout

```
contracts/guardia/   Rust, near-sdk 5 — src/lib.rs holds the contract and its unit tests
frontend/            React 18 + Vite 5 + TypeScript dashboard; deployed on Vercel (Root Directory = frontend)
  src/App.tsx        all pages: Overview, Agents, Incidents, Integrate, Settings
  src/lib/near.ts    view calls and formatting helpers
  src/lib/wallet.ts  wallet selector, signFunctionCall, pending-tx stash for redirect wallets
  src/lib/config.ts  default contract/agent, getRpcUrl()
  src/lib/events.ts  Nearblocks proxy for contract txs, explorerTx()
  vercel.json        /api/near-rpc and /api/nearblocks rewrites
watcher/             TypeScript CLI run with tsx
  src/index.ts       demo, live, watch and chain-demo modes
  src/policy.ts      offline mirror of the contract policy
  src/near.ts        RPC views and near CLI signing
  src/log.ts         text / JSON logger
```

## Commands

Run these before you say a change is done.

```bash
# contract
cd contracts/guardia && cargo test
cargo near build non-reproducible-wasm      # → target/near/guardia.wasm

# frontend
cd frontend && npm install && npm run build

# watcher
cd watcher && npm install && npm run typecheck && npm run demo
```

`npm run watch`, `npm run live` and `npm run chain-demo` hit testnet and sign with the owner key from
`~/.near-credentials/testnet/`. Use `GUARDIA_DRY_RUN=1` unless you are told to act on chain.

## Rules

### Contract
- `check_transfer` is a **view**. It must never write state. Only `commit_spend` moves `spent_today`.
- Mutations are owner-only (`assert_owner`). `commit_spend` is owner or the agent itself. Keep these checks.
- Amounts cross the ABI as **yocto strings**; parse with `parse_yocto`. Never use floats for money.
- Changing the `Contract` struct changes the storage layout. The deployed contract will fail to load unless you
  add a migration, so avoid layout changes unless asked.
- `migrate` must stay `#[private]`.
- Add a unit test for any new policy rule. Each test commit must respect the 10 NEAR single-transfer limit.
- Emit an event (standard `guardia`) for every new state change so the dashboard incident feed can show it.

### Frontend
- Browser RPC goes through the same-origin `/api/near-rpc` proxy (`getRpcUrl()`), including the wallet selector's
  `nodeUrl`. Do not point the browser at public RPC directly, as it gets rate-limited.
- Background polling (~20s) must not blank the Policy Surface. Show skeletons on first load only.
- Probe/Check uses `check_transfer` only; Commit uses `commit_spend` and needs the owner wallet.
- `previewDecision()` in `src/lib/near.ts` mirrors `Policy::evaluate` (frozen → single limit → daily budget). If the
  contract rules change, change it too. Convert amounts with `nearToYocto()`, which keeps decimals.
- Local `npm run dev` / `npm run preview` proxy `/api/near-rpc` and `/api/nearblocks` like `vercel.json` does.
- Explorer links use `https://testnet.nearblocks.io` (`explorerTx()`). `explorer.testnet.near.org` is retired.
- Keep the visual style: charcoal background, lime `--lime: #d4ff00` accent, IBM Plex Sans/Mono. Logo lives at
  `frontend/public/guardia-mark.svg`.

### Watcher
- Configure through `GUARDIA_*` env vars (see `watcher/README.md`). Add new options there and in the README.
- Freezing is the only action the watcher takes on chain. It never unfreezes automatically.
- Keep `GUARDIA_DRY_RUN` and `GUARDIA_AUTO_FREEZE=0` working: they must log instead of signing.

## Secrets

Never commit private keys, seed phrases, `.env` files or anything from `~/.near-credentials`. Never print
credentials in logs.

## Git

- One-line Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), scoped when useful, e.g.
  `fix(watcher): ...`.
- Work on a branch and open a PR into `main`. Vercel deploys `main`.
- Keep README.md, watcher/README.md and this file in sync with behaviour changes.
