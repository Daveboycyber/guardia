# Guardia watcher

Off-chain companion for the Guardia policy contract.

## Local demo (no keys, no RPC)

```bash
cd watcher
npm install
npm run demo
```

## Live view + auto-freeze

```bash
npm install

# 1 NEAR — should ALLOW (if agent not frozen)
GUARDIA_CONTRACT=skar.testnet \
GUARDIA_AGENT=agent.skar.testnet \
npm run live

# 20 NEAR — BLOCK, then freeze_agent if GUARDIA_PRIVATE_KEY is set
GUARDIA_CONTRACT=skar.testnet \
GUARDIA_AGENT=agent.skar.testnet \
GUARDIA_OWNER=skar.testnet \
GUARDIA_NEAR=20 \
GUARDIA_PRIVATE_KEY='ed25519:...' \
npm run live
```

### Env vars

| Variable | Meaning |
|----------|---------|
| `GUARDIA_CONTRACT` | Policy contract account (default `skar.testnet`) |
| `GUARDIA_AGENT` | Agent to check |
| `GUARDIA_NEAR` | Transfer size in NEAR (default `1`) |
| `GUARDIA_AMOUNT` | Or raw yoctoNEAR string |
| `GUARDIA_OWNER` | Signer; must be contract owner |
| `GUARDIA_PRIVATE_KEY` | Full-access key `ed25519:...` for owner |
| `GUARDIA_AUTO_FREEZE` | Set to `0` to only report, never freeze |

### Private key

From the credential file created by near-cli (do not commit this):

```bash
cat ~/.near-credentials/testnet/skar.testnet.json
```

Copy the `private_key` field into `GUARDIA_PRIVATE_KEY`.

Auto-freeze runs only when `check_transfer` returns a policy violation (e.g. amount exceeds max). It skips if the agent is already frozen or not registered.
