# Guardia watcher

Off-chain guard for the Guardia policy contract. Four modes:

| Command | What it does | Chain? | Signs? |
|---------|--------------|--------|--------|
| `npm run demo` | Local policy mirror (single + daily caps, freeze) | no | no |
| `npm run live` | One-shot `check_transfer`; freeze on breach | yes | on breach |
| `npm run watch` | **Continuous** defense loop over every agent | yes | on breach |
| `npm run chain-demo` | Golden demo path on testnet, prints tx links | yes | yes |

Signing uses the `near` CLI ([near-cli-rs](https://github.com/near/near-cli-rs)) with the legacy keychain at
`~/.near-credentials/testnet/<owner>.json`. No private key is ever pasted, logged, or read by the watcher itself.
Without credentials, freezes are skipped and logged as `freeze_skipped`.

```bash
cd watcher
npm install
```

## Continuous watch

```bash
GUARDIA_CONTRACT=skar.testnet \
GUARDIA_OWNER=skar.testnet \
npm run watch
```

Each tick (default 15s) it reads `get_policy` + `get_usage` for every agent returned by `list_agents()` and freezes an
agent when any rule trips:

| Rule | Trips when | Tune with |
|------|-----------|-----------|
| Budget threshold | `spent_today` ≥ N% of `max_daily_volume` | `GUARDIA_FREEZE_AT_PCT` (default 90, `0` disables) |
| Velocity | spend committed since last tick > limit | `GUARDIA_MAX_TICK_NEAR` (default: agent's `max_single_transfer`, `0` disables) |
| Probe | `check_transfer(GUARDIA_PROBE_NEAR)` blocked by a limit | `GUARDIA_PROBE_NEAR` (off by default) |

Already-frozen agents are skipped. RPC errors are logged as `tick_failed` and the loop keeps going. The same breach is
alerted once, not every tick. A failed freeze is retried on the next tick. `Ctrl+C` stops cleanly.

Try it safely first:

```bash
GUARDIA_DRY_RUN=1 GUARDIA_PROBE_NEAR=20 GUARDIA_INTERVAL=5 npm run watch
```

```
02:47:58 watch_start  contract=skar.testnet ... dry_run=true
02:47:59 agent_seen  agent=agent.skar.testnet frozen=false spent_today="0 NEAR" max_single="10 NEAR" max_daily="50 NEAR"
02:47:59 WARN breach  agent=agent.skar.testnet rules="probe 20 NEAR blocked: ..."
02:47:59 WARN would_freeze  agent=agent.skar.testnet ... dry_run=true
02:47:59 tick  n=1 agents=1
```

Machine-readable logs: `GUARDIA_LOG=json npm run watch | jq`.

## One-shot live check

```bash
GUARDIA_AGENT=agent.skar.testnet GUARDIA_NEAR=20 npm run live
```

```
WARN block  agent=agent.skar.testnet amount="20 NEAR" reason="Amount ... exceeds max_single_transfer ..."
WARN agent_frozen  agent=agent.skar.testnet tx=... url=https://testnet.nearblocks.io/txns/...
verify  agent=agent.skar.testnet amount="1 NEAR" decision=BLOCK reason="Agent is frozen"
```

## Chain demo (golden path)

Requires owner credentials. Runs: unfreeze if needed → check 1 NEAR (ALLOW) → `commit_spend` 1 NEAR → check 20 NEAR
(BLOCK) → `freeze_agent` → check 1 NEAR (BLOCK, frozen), then prints nearblocks links for every transaction.

```bash
npm run chain-demo
GUARDIA_RESET=1 npm run chain-demo   # also unfreeze at the end
```

## Environment

| Variable | Default | Used by |
|----------|---------|---------|
| `GUARDIA_CONTRACT` | `skar.testnet` | all chain modes |
| `GUARDIA_AGENT` | `agent.skar.testnet` | live, chain-demo |
| `GUARDIA_AGENTS` | `list_agents()` | watch (comma-separated override) |
| `GUARDIA_OWNER` | `skar.testnet` | signer for freeze / demo |
| `GUARDIA_NEAR` / `GUARDIA_AMOUNT` | `1` NEAR / — | live probe amount (NEAR / yocto) |
| `GUARDIA_INTERVAL` | `15` | watch tick seconds |
| `GUARDIA_MAX_TICKS` | `0` (forever) | watch |
| `GUARDIA_DRY_RUN` | off | `1` = log `would_freeze`, never sign |
| `GUARDIA_AUTO_FREEZE` | on | `0` = report breaches only |
| `GUARDIA_LOG` | text | `json` = one JSON object per line |
| `GUARDIA_NEAR_CLI` | `near` | path to near-cli-rs binary |
| `NEAR_RPC_URL` | FastNear testnet | RPC endpoint |
