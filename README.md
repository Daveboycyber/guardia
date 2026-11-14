<p align="center">
  <img src="docs/guardia-logo.svg" alt="Guardia" width="360" />
</p>

# Guardia

**Real-time policy engine for agent-to-agent money flows on NEAR.**

AI Security for the Agent Economy on NEAR.

> Give AI agents money without giving them the keys to everything.

## What it is

Guardia is:

1. **On-chain policy** — register agents, single-transfer + daily limits, freeze, preview (`check_transfer`) and record spend (`commit_spend`)
2. **Dashboard** — React console for policy surface, probes, commit spend, freeze, agents, incidents
3. **Watcher** — TypeScript CLI that mirrors policy offline, or hits testnet and can auto-freeze on breach

**Primary track:** AI Security & Defense  
**Also fits:** Agent Economy, Autonomous Business

## Use cases

Anywhere software spends money on someone's behalf, Guardia puts a ceiling and a kill switch on it.

| Use case | How Guardia helps |
|----------|-------------------|
| **AI assistants that pay for things** | A personal agent that books travel, buys API credits or tips creators gets a per-payment cap and a daily budget, so one bad prompt can't empty the wallet. |
| **Agent-to-agent marketplaces** | Agents paying other agents for data, compute or tasks are capped per call and per day, and are frozen automatically if they start paying unusually fast. |
| **Trading and DeFi bots** | A strategy bot can rebalance within limits; a bug or exploited strategy that tries to move everything at once is blocked and frozen. |
| **DAO and treasury operators** | A DAO delegates routine payouts (grants, bounties, contributor pay) to an agent with a budget, instead of handing out a multisig key. |
| **Businesses running agent fleets** | One owner registers many agents (support refunds, procurement, ad spend), each with its own limits, and watches them from one dashboard. |
| **Pay-per-use APIs and subscriptions** | Usage-based payments to services stay inside a daily budget, even if the agent gets stuck in a loop. |
| **Prompt-injection defense** | When an agent reads a malicious web page or message telling it to "send everything to X", Guardia blocks the oversized payment and the watcher freezes the agent. |
| **Incident response** | Security teams get one switch to stop an agent's spending right away, and an on-chain record of what it tried to do. |

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

## How to use Guardia

Guardia sits between an AI agent and its money. The **owner** sets the rules, the **agent** asks Guardia before
every payment, and the **watcher** freezes the agent if something looks wrong.

### 1. Owner: register an agent and set limits

Open the dashboard and connect the owner wallet, then use **Agents → Register agent**. Limits are changed with `update_policy` from the terminal
([near-cli-rs](https://github.com/near/near-cli-rs)):

```bash
# register an agent (default policy: 10 NEAR single, 50 NEAR daily)
near contract call-function as-transaction skar.testnet register_agent \
  json-args '{"agent_id":"agent.skar.testnet"}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  sign-as skar.testnet network-config testnet sign-with-keychain send

# tighten limits (amounts are yoctoNEAR strings: 1 NEAR = 10^24)
near contract call-function as-transaction skar.testnet update_policy \
  json-args '{"agent_id":"agent.skar.testnet","max_single_transfer":"5000000000000000000000000","max_daily_volume":"20000000000000000000000000"}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  sign-as skar.testnet network-config testnet sign-with-keychain send
```

### 2. Agent: check before paying, commit after

Before the agent sends money, it asks Guardia whether the payment is allowed. If Guardia says yes, the agent pays and
records the spend so it counts toward the daily budget.

```ts
import { connect, keyStores } from "near-api-js";

const CONTRACT = "skar.testnet";
const AGENT = "agent.skar.testnet";

const near = await connect({
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.fastnear.com",
  keyStore: new keyStores.UnencryptedFileSystemKeyStore(`${process.env.HOME}/.near-credentials`),
});
const agent = await near.account(AGENT);

async function guardedPay(receiver: string, yocto: string) {
  // 1. preview: a free view call, no state change
  const [allowed, reason] = await agent.viewFunction({
    contractId: CONTRACT,
    methodName: "check_transfer",
    args: { agent_id: AGENT, amount: yocto },
  });
  if (!allowed) throw new Error(`Guardia blocked payment: ${reason}`);

  // 2. record the spend against today's budget
  await agent.functionCall({
    contractId: CONTRACT,
    methodName: "commit_spend",
    args: { agent_id: AGENT, amount: yocto },
  });

  // 3. make the actual payment
  await agent.sendMoney(receiver, BigInt(yocto));
}
```

Quick check from the terminal:

```bash
near contract call-function as-read-only skar.testnet check_transfer \
  json-args '{"agent_id":"agent.skar.testnet","amount":"1000000000000000000000000"}' \
  network-config testnet now
```

### 3. Watcher: freeze automatically

Run the watcher on a machine that has the owner key. It polls every agent and freezes any that crosses its budget
threshold or spends too fast.

```bash
cd watcher && npm install
GUARDIA_CONTRACT=skar.testnet GUARDIA_OWNER=skar.testnet npm run watch
# try it without signing anything first:
GUARDIA_DRY_RUN=1 GUARDIA_CONTRACT=skar.testnet GUARDIA_OWNER=skar.testnet npm run watch
```

### 4. Owner: respond to incidents

Frozen agents fail every check with `Agent is frozen`. Review the **Incidents** page, then **Unfreeze** from the
dashboard (or call `unfreeze_agent`) once the cause is fixed.

> Today the limits are enforced by the agent calling Guardia. An agent holding a full-access key could skip it. See
> [SECURITY.md](SECURITY.md) for the threat model and the planned vault mode.

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

## Roadmap

**Next**
- **Vault mode:** Guardia holds the agent's funds and makes the transfer itself, and the agent only gets a function-call
  key scoped to the Guardia contract. This turns limits from advisory into enforced.
- **Recipient allowlists:** per-agent lists of accounts the agent may pay, to stop "pay the attacker" injections.
- **Human approval above a threshold:** large payments wait in a queue until the owner approves them in the dashboard.
- **Hosted watcher:** always-on watcher with a heartbeat shown in the dashboard and alerts (Telegram, Slack, email).

**Then**
- **Agent SDK and MCP server:** a `guardedPay()` TypeScript/Python SDK and an MCP server so any AI agent framework
  (NEAR AI, Claude, LangChain and others) gets a payment tool that can't break policy.
- **Fungible tokens:** limits for USDC and other NEP-141 tokens, not just NEAR.
- **Smarter rules:** time-of-day windows, per-recipient caps, spend velocity and anomaly scoring on chain.
- **Multi-owner policies:** a DAO or multisig as owner, so changing limits or unfreezing needs more than one key.

**Later**
- **Multichain spending:** apply the same policy to payments an agent makes on other chains through NEAR Chain
  Signatures.
- **TEE-attested agents:** only agents running verified code in a trusted execution environment can spend, and
  Guardia checks the attestation.
- **Mainnet launch** after an independent security audit.

## Security

See [SECURITY.md](SECURITY.md). Contributors and AI coding agents: see [AGENTS.md](AGENTS.md).

## License

MIT
