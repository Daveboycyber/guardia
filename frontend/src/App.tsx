import { useCallback, useEffect, useState } from "react";
import {
  checkTransfer,
  DEFAULT_AGENT,
  DEFAULT_CONTRACT,
  formatNear,
  getPolicy,
  isFrozen,
  nearToYocto,
  type PolicyView,
} from "./lib/near";

type LogItem = {
  id: string;
  kind: "allow" | "block" | "info";
  title: string;
  detail: string;
  at: string;
};

function nowStamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function App() {
  const contractId = DEFAULT_CONTRACT;
  const agentId = DEFAULT_AGENT;

  const [policy, setPolicy] = useState<PolicyView>(null);
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);

  const pushLog = useCallback((item: Omit<LogItem, "id" | "at">) => {
    setLog((prev) => [
      { ...item, id: crypto.randomUUID(), at: nowStamp() },
      ...prev,
    ].slice(0, 40));
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [p, f] = await Promise.all([
        getPolicy(contractId, agentId),
        isFrozen(contractId, agentId),
      ]);
      setPolicy(p);
      setFrozen(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [contractId, agentId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function runCheck(nearAmount: number) {
    setBusy(true);
    setError(null);
    try {
      const result = await checkTransfer(
        contractId,
        agentId,
        nearToYocto(nearAmount),
      );
      pushLog({
        kind: result.allowed ? "allow" : "block",
        title: `${result.allowed ? "ALLOW" : "BLOCK"} · ${nearAmount} NEAR`,
        detail: result.reason,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const statusClass =
    frozen === null ? "unknown" : frozen ? "frozen" : "live";
  const statusLabel =
    frozen === null ? "Connecting…" : frozen ? "Agent frozen" : "Agent live";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span className="dot" />
            Guardia
          </div>
          <h1>Agent money defense</h1>
          <p>
            On-chain policy engine for agent-to-agent flows. Watch limits in real
            time, freeze suspicious drains before value leaves.
          </p>
        </div>
        <div className="network-pill">
          network <strong>testnet</strong> · contract{" "}
          <strong>{contractId}</strong>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="grid">
        <section className="panel status-hero">
          <div className="panel-header">
            <h2>Protected agent</h2>
            <button
              type="button"
              className="btn-ghost"
              disabled={loading || busy}
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="loading">Syncing policy state…</div>
          ) : (
            <>
              <div className={`status-badge ${statusClass}`}>
                <span className="pulse" />
                {statusLabel}
              </div>

              <div className="meta-list">
                <div className="meta-row">
                  <span>Agent</span>
                  <code>{agentId}</code>
                </div>
                <div className="meta-row">
                  <span>Contract</span>
                  <code>{contractId}</code>
                </div>
                <div className="meta-row">
                  <span>Explorer</span>
                  <code>
                    <a
                      href={`https://explorer.testnet.near.org/accounts/${contractId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--lime)" }}
                    >
                      open account
                    </a>
                  </code>
                </div>
              </div>

              <div className="metrics">
                <div className="metric">
                  <label>Max single transfer</label>
                  <strong>
                    {policy ? formatNear(policy.maxSingle) : "—"}
                  </strong>
                </div>
                <div className="metric">
                  <label>Max daily volume</label>
                  <strong>
                    {policy ? formatNear(policy.maxDaily) : "—"}
                  </strong>
                </div>
              </div>

              <div className="actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void runCheck(1)}
                >
                  Probe 1 NEAR
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy}
                  onClick={() => void runCheck(20)}
                >
                  Probe 20 NEAR (attack)
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void runCheck(5)}
                >
                  Probe 5 NEAR
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Decision feed</h2>
          </div>
          <div className="feed">
            {log.length === 0 ? (
              <div className="feed-empty">
                No probes yet. Run a transfer check to stream ALLOW / BLOCK
                decisions from the live contract.
              </div>
            ) : (
              log.map((item) => (
                <article key={item.id} className={`event ${item.kind}`}>
                  <div className="event-tag">{item.kind}</div>
                  <div className="event-body">
                    <strong>{item.title}</strong>
                    <span>
                      {item.at} · {item.detail}
                    </span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <p className="footer-note">
        Read-only probes call <code>check_transfer</code> on-chain. Freeze /
        unfreeze still run from the watcher or near CLI as owner{" "}
        <code>skar.testnet</code>.{" "}
        <a
          href="https://github.com/Daveboycyber/guardia"
          target="_blank"
          rel="noreferrer"
        >
          Source
        </a>
      </p>
    </div>
  );
}
