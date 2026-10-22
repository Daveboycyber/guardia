# Guardia watcher

Off-chain companion for the Guardia policy contract.

## Local demo (no keys, no RPC)

```bash
cd watcher
npm install
npm run demo
```

Prints ALLOW / BLOCK decisions using the same rules as the contract, then freezes the agent after an oversized transfer.

## Live view call (after testnet deploy)

```bash
GUARDIA_CONTRACT=guardia.youraccount.testnet \
GUARDIA_AGENT=agent.youraccount.testnet \
npm run watch
```

Calls `check_transfer` on testnet RPC. Freeze transactions still need the contract owner key (next step).
