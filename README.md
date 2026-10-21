# Guardia

**Real-time scam & anomaly detector for agent-to-agent money flows on NEAR.**

AI Security for the Agent Economy — built for the [NEAR Hackathon 2026](https://nearhackathon.com).

> Give AI agents money without giving them the keys to everything.

## Vision

Guardia is an on-chain policy engine + watcher that monitors transfers between AI agents in near real-time, scores them for scam / anomaly risk, and can automatically freeze or throttle suspicious flows before the money leaves.

### Core Features (MVP)
- Registry of protected agent accounts
- Configurable policy rules (velocity limits, amount thresholds, new counterparty detection, etc.)
- Ability to freeze / pause outgoing transfers from an agent
- Risk scoring + decision logging
- Simple dashboard for live monitoring

### Tracks
- Primary: **AI Security & Defense**
- Also relevant: Agent Economy, Autonomous Business

## Project Structure

```
guardia/
├── contracts/
│   └── guardia/          # Rust smart contract (Guardian / policy engine)
├── watcher/             # TypeScript off-chain watcher (coming next)
├── frontend/            # Dashboard (coming later)
├── scripts/             # Agent simulators for demos
└── README.md
```

## Getting Started (Contract)

### Prerequisites
- Rust + cargo
- [`cargo-near`](https://github.com/near/cargo-near)
- NEAR CLI (`near-cli-rs` recommended)

### Build
```bash
cd contracts/guardia
cargo near build
```

### Test
```bash
cargo test
```

## Status

🚧 Early development — contract foundation in progress.

## License

MIT
