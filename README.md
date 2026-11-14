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

Same path from the terminal, with tx links: `cd watcher && npm run chain-demo` (needs owner credentials).

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
npm run demo          # offline policy mirror (single + daily caps, freeze)
npm run watch         # continuous guard over every agent, auto-freeze on breach
npm run live          # one-shot check_transfer + freeze on breach
npm run chain-demo    # golden demo path on testnet, prints nearblocks tx links
```

`watch` polls `get_policy` / `get_usage` for every agent in `list_agents()` and freezes when daily budget use crosses a
threshold (default 90%), when spend velocity between ticks exceeds the agent's single-transfer limit, or when an optional
probe amount is blocked. `GUARDIA_DRY_RUN=1` logs `would_freeze` without signing; `GUARDIA_LOG=json` emits structured
logs. Signing uses `near` CLI + `~/.near-credentials/testnet/<owner>.json`; without credentials, freezes are skipped and logged.

Details and all env vars: [watcher/README.md](watcher/README.md).

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
- Watcher: continuous `watch` loop (budget threshold, velocity, probe rules), dry-run, JSON logs, one-shot `live`, scripted `chain-demo`
- Explorer links: nearblocks testnet (the legacy `explorer.testnet.near.org` is retired)
- Gaps: watcher runs as a process you keep alive (systemd / pm2 / container), not a hosted service; incident stream depends on Nearblocks coverage

## Hackathon submission

- **Deadline:** 14 Nov 2026, 23:59 UTC
- Public repo + demo post on X (`@NEARProtocol`, `#NEARHackathon`) + form on [nearhackathon.com](https://nearhackathon.com)
- Submission is one-shot (changes via request-changes only)

## License

MIT
