# Security Policy

Guardia is a hackathon MVP running on **NEAR testnet**. It is not audited and must not guard mainnet funds.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on
[Daveboycyber/guardia](https://github.com/Daveboycyber/guardia/security). Do not open a public issue for
anything that could let someone bypass a policy, unfreeze an agent, or act as the owner.

Include the affected component (contract / watcher / dashboard), steps to reproduce, and the impact. We aim to
acknowledge within 72 hours.

## Supported versions

| Component | Version | Supported |
|-----------|---------|-----------|
| Contract on `skar.testnet` | current `main` | ✅ |
| Dashboard (Vercel, `frontend/`) | current `main` | ✅ |
| Watcher (`watcher/`) | current `main` | ✅ |
| Anything else | — | ❌ |

## Threat model

Guardia's goal is to let an owner give an AI agent money without giving it unrestricted control. These are the
trust assumptions behind the current MVP.

### Trusted

- **Owner account** (`skar.testnet`): the only account that can register agents, change limits, freeze and unfreeze.
  If the owner key is compromised, every policy is compromised.
- **NEAR runtime and RPC**: the dashboard reads through the `/api/near-rpc` proxy to FastNear, and the watcher reads
  from `NEAR_RPC_URL`. A malicious RPC can show false policy state, but it cannot sign transactions.

### Not trusted

- **Agents**: an agent may be buggy, prompt-injected or malicious. It can call `commit_spend` only for itself.
- **Everyone else**: they can call views (`check_transfer`, `get_policy`, `get_usage`, `list_agents`) but no mutations.

### What the contract enforces

| Control | Enforced by |
|---------|-------------|
| Only the owner registers agents, updates policy, freezes and unfreezes | `assert_owner` |
| Only the owner or the agent itself can record spend | `commit_spend` caller check |
| Single-transfer cap, daily cap, frozen state | `Policy::evaluate` |
| Daily budget resets per UTC day | `epoch_day` bucket from `block_timestamp` |
| State migration only by the contract account | `#[private]` on `migrate` |

### Known limitations

- **Limits are advisory today.** `check_transfer` and `commit_spend` record and evaluate spend, but the contract does
  not hold or move the agent's funds. An agent with a full-access key can send NEAR directly and bypass Guardia.
  Planned mitigation: a vault mode where Guardia holds the funds and performs the transfer, with agents limited to a
  function-call access key scoped to the Guardia contract.
- **The watcher signs with a local owner key.** It shells out to `near` CLI using
  `~/.near-credentials/testnet/<owner>.json`. Run it on a machine you control, and use `GUARDIA_DRY_RUN=1` when
  testing. Without credentials it only logs.
- **The watcher is a process, not a service.** If it is not running, nothing auto-freezes.
- **The incident feed depends on Nearblocks.** Missing indexer data means missing incidents in the UI; on-chain
  state is still the source of truth.

## Secrets

- Never commit private keys, seed phrases, or `~/.near-credentials` contents.
- `.env` and `.env.local` are git-ignored. Keep RPC keys and owner credentials in local env vars only.
- The dashboard signs through the user's wallet and never handles private keys.
