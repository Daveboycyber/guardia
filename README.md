# Guardia

**Real-time policy engine for agent-to-agent money flows on NEAR.**

AI Security for the Agent Economy — [NEAR Hackathon 2026](https://nearhackathon.com).

> Give AI agents money without giving them the keys to everything.

## What it is

Guardia is:

1. **On-chain policy** — register agents, single-transfer + daily limits, freeze, preview (`check_transfer`) and record spend (`commit_spend`)
2. **Dashboard** — React console for policy surface, probes, commit spend, freeze, agents, incidents
3. **Watcher** — TypeScript CLI that mirrors policy offline, or hits testnet and can auto-freeze on breach

**Primary track:** AI Security & Defense  
**Also fits:** Agent Economy, Autonomous Business

## Live targets (testnet)

| Item | Value |
|------|--------|
| Contract | `skar.testnet` |
| Agent | `agent.skar.testnet` |
| Owner | `skar.testnet` |
| Default limits | 10 NEAR single · 50 NEAR daily |
| Dashboard | Vercel project built from `frontend/` |

## Repository

```
guardia/
├── contracts/guardia/   # Rust near-sdk policy engine
├── frontend/            # React + Vite dashboard
├── watcher/             # TypeScript demo + live auto-freeze CLI
└── README.md
```

## Quick demo (dashboard)

1. Open the deployed dashboard (or `cd frontend && npm i && npm run dev`).
2. Unfreeze the agent if a prior run left it frozen.
3. **Check 1 NEAR** → ALLOW. **Commit spend** (owner wallet) → Spent today moves.
4. **Check / commit 20 NEAR** → BLOCK (over single limit).
5. **Freeze** → **Check 1 NEAR** → BLOCK (`Agent is frozen`).

`check_transfer` is a **view** (preview only). **`commit_spend`** is what consumes the daily budget.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

- Wallet: MyNearWallet via `@near-wallet-selector`
- Browser RPC: same-origin `/api/near-rpc` → FastNear (see `vercel.json`) — avoids public RPC rate limits
- Events: `/api/nearblocks` proxy to Nearblocks testnet API

Vercel: set **Root Directory** to `frontend`.

## Watcher

```bash
cd watcher
npm install
npm run demo          # offline policy mirror
```

Live check + optional auto-freeze (needs `near` CLI + `~/.near-credentials/testnet/skar.testnet.json`):

```bash
GUARDIA_CONTRACT=skar.testnet \
GUARDIA_AGENT=agent.skar.testnet \
GUARDIA_OWNER=skar.testnet \
GUARDIA_NEAR=20 \
npm run live
```

`GUARDIA_AUTO_FREEZE=0` reports only. This is a **one-shot** process, not a long-running daemon.

Details: [watcher/README.md](watcher/README.md).

## Contract

```bash
cd contracts/guardia
cargo test
cargo near build non-reproducible-wasm
```

WASM: `target/near/guardia.wasm`.

### Important methods

| Method | Who | Effect |
|--------|-----|--------|
| `register_agent` | owner | Create default policy |
| `check_transfer` | anyone (view) | Preview allow/block — **no state write** |
| `commit_spend` | owner or agent | Count amount toward daily cap |
| `freeze_agent` / `unfreeze_agent` | owner | Kill switch |
| `get_policy` / `get_usage` / `list_agents` | view | Dashboard data |

Deploy / register examples (replace accounts as needed):

```bash
cargo near deploy skar.testnet \
  with-init-call new \
  json-args '{"owner_id":"skar.testnet"}' \
  prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' \
  network-config testnet \
  sign-with-keychain \
  send
```

## Status (MVP)

- Contract: deployed testnet, unit tests in-repo
- Dashboard: deployed, policy surface + probes + commit + freeze
- Watcher: demo + live auto-freeze path
- Gaps: watcher is not continuous; incident stream depends on indexer coverage

## Hackathon submission

- **Deadline:** 14 Nov 2026, 23:59 UTC
- Public repo + demo post on X (`@NEARProtocol`, `#NEARHackathon`) + form on [nearhackathon.com](https://nearhackathon.com)
- Submission is one-shot (changes via request-changes only)

## License

MIT
