# Guardia watcher

Off-chain companion for the Guardia policy contract.

## Local demo

```bash
npm install
npm run demo
```

## Live view + auto-freeze

Uses the same `near` CLI + `~/.near-credentials` keychain as your manual deploy. No private-key paste required.

```bash
git pull
cd watcher
npm install

# Ensure agent is not already frozen, then:
GUARDIA_CONTRACT=skar.testnet \
GUARDIA_AGENT=agent.skar.testnet \
GUARDIA_OWNER=skar.testnet \
GUARDIA_NEAR=20 \
npm run live
```

Expected:

```
BLOCK  20 NEAR  ...
FREEZE  freeze_agent as skar.testnet ...
       frozen  tx ...
VERIFY  1 NEAR after freeze → BLOCK
       Agent is frozen
```

Set `GUARDIA_AUTO_FREEZE=0` to only report without calling freeze.
