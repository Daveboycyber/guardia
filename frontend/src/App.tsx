import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchContractEvents,
  formatEventTime,
  type ChainEvent,
} from "./lib/events";
import {
  checkTransfer,
  DEFAULT_AGENT,
  DEFAULT_CONTRACT,
  formatNear,
  getPolicy,
  isFrozen,
  nearToYocto,
  ONE_NEAR,
  type PolicyView,
} from "./lib/near";

type LogItem = {
  id: string;
  kind: "allow" | "block" | "info" | "system";
  title: string;
  detail: string;
  at: string;
  amount?: number;
};

type FlowStep = {
  id: string;
  label: string;
  description: string;
  actionLabel: string;
  run: () => Promise<void>;
};

function nowStamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function riskLevel(amountNear: number, maxNear: number | null): {
  score: number;
  label: string;
  tone: "low" | "mid" | "high" | "critical";
} {
  if (maxNear == null || maxNear <= 0) {
    return { score: 0, label: "Unknown", tone: "mid" };
  }
  const ratio = amountNear / maxNear;
  if (ratio <= 0.25) return { score: 12, label: "Nominal", tone: "low" };
  if (ratio <= 0.6) return { score: 38, label: "Elevated", tone: "mid" };
  if (ratio <= 1) return { score: 62, label: "Near limit", tone: "high" };
  return { score: 94, label: "Policy breach", tone: "critical" };
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
  const [customNear, setCustomNear] = useState("3");
  const [flowIndex, setFlowIndex] = useState(0);
  const [lastDecision, setLastDecision] = useState<{
    allowed: boolean;
    reason: string;
    amount: number;
  } | null>(null);
  const [stats, setStats] = useState({ allows: 0, blocks: 0 });
  const [chainEvents, setChainEvents] = useState<ChainEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamLive, setStreamLive] = useState(false);
  const seenTx = useRef(new Set<string>());

  const maxNear = useMemo(() => {
    if (!policy) return null;
    try {
      return Number(BigInt(policy.maxSingle) / ONE_NEAR);
    } catch {
      return null;
    }
  }, [policy]);

  const pushLog = useCallback((item: Omit<LogItem, "id" | "at">) => {
    setLog((prev) =>
      [{ ...item, id: crypto.randomUUID(), at: nowStamp() }, ...prev].slice(0, 50),
    );
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

  const pullChain = useCallback(async () => {
    try {
      const events = await fetchContractEvents(contractId, 25);
      setChainEvents(events);
      setStreamLive(true);
      setStreamError(null);

      for (const ev of events) {
        if (seenTx.current.has(ev.id)) continue;
        seenTx.current.add(ev.id);
        // Only announce newly seen txs after the first successful pull
        if (seenTx.current.size > events.length) {
          pushLog({
            kind: "system",
            title: `Chain · ${ev.method}`,
            detail: `${ev.summary} · ${ev.txHash.slice(0, 10)}…`,
          });
        }
      }
      // Seed seen set on first load without flooding the decision feed
      if (seenTx.current.size <= events.length) {
        for (const ev of events) seenTx.current.add(ev.id);
      }
    } catch (e) {
      setStreamLive(false);
      setStreamError(e instanceof Error ? e.message : String(e));
    }
  }, [contractId, pushLog]);

  useEffect(() => {
    void refresh();
    void pullChain();
    const t = setInterval(() => {
      void refresh();
      void pullChain();
    }, 10_000);
    return () => clearInterval(t);
  }, [refresh, pullChain]);

  const runCheck = useCallback(
    async (nearAmount: number, label?: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await checkTransfer(
          contractId,
          agentId,
          nearToYocto(nearAmount),
        );
        setLastDecision({ ...result, amount: nearAmount });
        setStats((s) =>
          result.allowed
            ? { ...s, allows: s.allows + 1 }
            : { ...s, blocks: s.blocks + 1 },
        );
        pushLog({
          kind: result.allowed ? "allow" : "block",
          title: `${result.allowed ? "ALLOW" : "BLOCK"} · ${nearAmount} NEAR${label ? ` · ${label}` : ""}`,
          detail: result.reason,
          amount: nearAmount,
        });
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [agentId, contractId, pushLog, refresh],
  );

  const flowSteps: FlowStep[] = useMemo(
    () => [
      {
        id: "sync",
        label: "Sync state",
        description: "Pull live policy, freeze status, and recent chain events.",
        actionLabel: "Sync on-chain state",
        run: async () => {
          await Promise.all([refresh(), pullChain()]);
          pushLog({
            kind: "system",
            title: "State synchronized",
            detail: `Agent ${agentId} · frozen=${String(frozen)}`,
          });
        },
      },
      {
        id: "baseline",
        label: "Baseline",
        description: "Probe a normal 1 NEAR payment under the policy ceiling.",
        actionLabel: "Run baseline (1 NEAR)",
        run: async () => {
          await runCheck(1, "baseline");
        },
      },
      {
        id: "attack",
        label: "Attack",
        description: "Simulate an oversized drain attempt (20 NEAR).",
        actionLabel: "Simulate drain (20 NEAR)",
        run: async () => {
          await runCheck(20, "drain attempt");
        },
      },
      {
        id: "response",
        label: "Response",
        description:
          "Auto-freeze runs in the watcher CLI. Watch the chain stream for freeze_agent.",
        actionLabel: "Refresh chain stream",
        run: async () => {
          await pullChain();
          pushLog({
            kind: "info",
            title: "Awaiting freeze on chain",
            detail:
              "Run watcher GUARDIA_NEAR=20 or near CLI freeze_agent; stream updates automatically.",
          });
        },
      },
      {
        id: "verify",
        label: "Verify",
        description: "Re-check 1 NEAR to confirm post-incident enforcement.",
        actionLabel: "Verify 1 NEAR",
        run: async () => {
          await runCheck(1, "post-incident");
        },
      },
    ],
    [agentId, frozen, pullChain, pushLog, refresh, runCheck],
  );

  const activeStep = flowSteps[Math.min(flowIndex, flowSteps.length - 1)];

  async function advanceFlow() {
    if (busy) return;
    try {
      await activeStep.run();
      setFlowIndex((i) => Math.min(i + 1, flowSteps.length - 1));
    } catch {
      /* error already set */
    }
  }

  function resetFlow() {
    setFlowIndex(0);
    setLastDecision(null);
    setStats({ allows: 0, blocks: 0 });
    setLog([]);
    pushLog({
      kind: "system",
      title: "Flow reset",
      detail: "Incident playbook returned to step 1.",
    });
  }

  const probeRisk = riskLevel(Number(customNear) || 0, maxNear);
  const lastRisk = lastDecision
    ? riskLevel(lastDecision.amount, maxNear)
    : null;

  const statusClass =
    frozen === null ? "unknown" : frozen ? "frozen" : "live";
  const statusLabel =
    frozen === null ? "Connecting" : frozen ? "Frozen" : "Live";

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <span className="mark" />
          <div>
            <strong>Guardia</strong>
            <span>Agent money defense</span>
          </div>
        </div>

        <div className="rail-section">
          <p className="rail-label">Network</p>
          <div className="rail-chip">NEAR testnet</div>
          <p className="rail-meta">Contract</p>
          <code className="rail-code">{contractId}</code>
          <p className="rail-meta">Agent</p>
          <code className="rail-code">{agentId}</code>
        </div>

        <div className="rail-section stats">
          <div>
            <span>Allows</span>
            <strong>{stats.allows}</strong>
          </div>
          <div>
            <span>Blocks</span>
            <strong className="danger-text">{stats.blocks}</strong>
          </div>
        </div>

        <div className="rail-section">
          <p className="rail-label">Stream</p>
          <div className={`stream-pill ${streamLive ? "on" : "off"}`}>
            <span className="pulse" />
            {streamLive ? "Indexer live" : "Indexer offline"}
          </div>
        </div>

        <a
          className="rail-link"
          href={`https://explorer.testnet.near.org/accounts/${contractId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open explorer ↗
        </a>
      </aside>

      <main className="main">
        <header className="main-head">
          <div>
            <p className="eyebrow">Operations console</p>
            <h1>Incident response flow</h1>
          </div>
          <div className={`status-pill ${statusClass}`}>
            <span className="pulse" />
            {statusLabel}
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <section className="flow-panel">
          <div className="flow-track">
            {flowSteps.map((step, i) => {
              const state =
                i < flowIndex ? "done" : i === flowIndex ? "active" : "todo";
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`flow-step ${state}`}
                  onClick={() => setFlowIndex(i)}
                  disabled={busy}
                >
                  <span className="flow-index">{i + 1}</span>
                  <span className="flow-label">{step.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flow-body">
            <div>
              <h2>{activeStep.label}</h2>
              <p>{activeStep.description}</p>
            </div>
            <div className="flow-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || loading}
                onClick={() => void advanceFlow()}
              >
                {busy ? "Running…" : activeStep.actionLabel}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={resetFlow}
              >
                Reset flow
              </button>
            </div>
          </div>
        </section>

        <div className="workspace">
          <section className="panel">
            <div className="panel-header">
              <h2>Policy surface</h2>
              <button
                type="button"
                className="btn-ghost sm"
                disabled={loading || busy}
                onClick={() => void refresh()}
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="loading">Syncing on-chain state…</div>
            ) : (
              <>
                <div className="metric-grid">
                  <div className="metric">
                    <label>Max single</label>
                    <strong>{policy ? formatNear(policy.maxSingle) : "—"}</strong>
                  </div>
                  <div className="metric">
                    <label>Max daily</label>
                    <strong>{policy ? formatNear(policy.maxDaily) : "—"}</strong>
                  </div>
                  <div className="metric">
                    <label>Freeze flag</label>
                    <strong className={frozen ? "danger-text" : "ok-text"}>
                      {frozen == null ? "—" : frozen ? "TRUE" : "FALSE"}
                    </strong>
                  </div>
                  <div className="metric">
                    <label>Last verdict</label>
                    <strong>
                      {lastDecision
                        ? lastDecision.allowed
                          ? "ALLOW"
                          : "BLOCK"
                        : "—"}
                    </strong>
                  </div>
                </div>

                {lastRisk && (
                  <div className={`risk-card ${lastRisk.tone}`}>
                    <div className="risk-head">
                      <span>Risk assessment</span>
                      <strong>{lastRisk.label}</strong>
                    </div>
                    <div className="risk-bar">
                      <div style={{ width: `${lastRisk.score}%` }} />
                    </div>
                    <p>
                      Last probe {lastDecision?.amount} NEAR against{" "}
                      {maxNear ?? "?"} NEAR ceiling · {lastDecision?.reason}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Probe console</h2>
            </div>
            <p className="panel-copy">
              Submit a proposed transfer size. Guardia evaluates against live
              policy without moving funds.
            </p>

            <div className="probe-row">
              <label htmlFor="custom-near">Amount (NEAR)</label>
              <div className="probe-input">
                <input
                  id="custom-near"
                  type="number"
                  min="0"
                  step="1"
                  value={customNear}
                  onChange={(e) => setCustomNear(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !customNear}
                  onClick={() => void runCheck(Number(customNear) || 0, "custom")}
                >
                  Evaluate
                </button>
              </div>
            </div>

            <div className={`risk-inline ${probeRisk.tone}`}>
              <span>Projected risk</span>
              <strong>{probeRisk.label}</strong>
            </div>

            <div className="quick-actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void runCheck(1)}
              >
                1 NEAR
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void runCheck(5)}
              >
                5 NEAR
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => void runCheck(20, "attack")}
              >
                20 NEAR attack
              </button>
            </div>
          </section>

          <section className="panel feed-panel">
            <div className="panel-header">
              <h2>On-chain event stream</h2>
              <button
                type="button"
                className="btn-ghost sm"
                onClick={() => void pullChain()}
              >
                Pull now
              </button>
            </div>
            {streamError && (
              <div className="stream-error">Indexer: {streamError}</div>
            )}
            <div className="chain-feed">
              {chainEvents.length === 0 ? (
                <div className="feed-empty">
                  Waiting for transactions to <code>{contractId}</code>. Freeze,
                  register, and policy calls appear here within ~10s.
                </div>
              ) : (
                chainEvents.map((ev) => (
                  <article key={ev.id} className={`chain-event ${ev.status}`}>
                    <div className="chain-meta">
                      <span className="chain-method">{ev.method}</span>
                      <span className="chain-time">{formatEventTime(ev.at)}</span>
                    </div>
                    <strong>{ev.summary}</strong>
                    {ev.eventName && (
                      <span className="chain-nep">NEP-297 · {ev.eventName}</span>
                    )}
                    <a
                      href={ev.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="chain-link"
                    >
                      {ev.txHash.slice(0, 16)}… ↗
                    </a>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel feed-panel">
            <div className="panel-header">
              <h2>Session decision timeline</h2>
            </div>
            <div className="feed">
              {log.length === 0 ? (
                <div className="feed-empty">
                  Run the incident flow or a probe to stream live ALLOW / BLOCK
                  decisions in this session.
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

        <footer className="footer-note">
          Chain stream polls NearBlocks testnet for <code>{contractId}</code>{" "}
          every 10s and parses NEP-297 <code>EVENT_JSON</code> logs when present.
          Probes call <code>check_transfer</code> over RPC.{" "}
          <a
            href="https://github.com/Daveboycyber/guardia"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        </footer>
      </main>
    </div>
  );
}
