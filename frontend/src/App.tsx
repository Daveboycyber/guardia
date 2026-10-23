import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_AGENT,
  loadContractId,
  loadKnownAgents,
  rememberAgent,
  saveContractId,
  saveKnownAgents,
} from "./lib/config";
import {
  fetchContractEvents,
  formatEventTime,
  type ChainEvent,
} from "./lib/events";
import {
  checkTransfer,
  formatNear,
  getPolicy,
  isFrozen,
  nearToYocto,
  type PolicyView,
  yoctoToNearNumber,
} from "./lib/near";
import { pushToast, subscribeToasts, type Toast } from "./lib/toast";
import {
  getAccountId,
  getModal,
  getSelector,
  signFunctionCall,
} from "./lib/wallet";

type Page = "overview" | "agents" | "incidents" | "integrate" | "settings";

type SessionDecision = {
  id: string;
  at: string;
  allowed: boolean;
  amount: number;
  agentId: string;
  reason: string;
};

type AgentRow = {
  id: string;
  policy: PolicyView;
  loading: boolean;
};

function nowStamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function riskTone(amount: number, maxNear: number | null) {
  if (maxNear == null || maxNear <= 0) return "mid" as const;
  const r = amount / maxNear;
  if (r <= 0.25) return "low" as const;
  if (r <= 0.6) return "mid" as const;
  if (r <= 1) return "high" as const;
  return "critical" as const;
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [contractId, setContractId] = useState(loadContractId);
  const [activeAgent, setActiveAgent] = useState(
    () => loadKnownAgents()[0] ?? DEFAULT_AGENT,
  );
  const [agents, setAgents] = useState<string[]>(loadKnownAgents);
  const [agentRows, setAgentRows] = useState<AgentRow[]>([]);
  const [policy, setPolicy] = useState<PolicyView>(null);
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [chainEvents, setChainEvents] = useState<ChainEvent[]>([]);
  const [streamLive, setStreamLive] = useState(false);
  const [decisions, setDecisions] = useState<SessionDecision[]>([]);
  const [customNear, setCustomNear] = useState("1");
  const [registerId, setRegisterId] = useState("");
  const [limitSingle, setLimitSingle] = useState("10");
  const [limitDaily, setLimitDaily] = useState("50");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [flowStep, setFlowStep] = useState(0);

  useEffect(() => subscribeToasts(setToasts), []);

  useEffect(() => {
    void (async () => {
      try {
        await getSelector();
        const id = await getAccountId();
        setAccountId(id);
        const selector = await getSelector();
        const sub = selector.store.observable.subscribe(async () => {
          setAccountId(await getAccountId());
        });
        return () => sub.unsubscribe();
      } catch (e) {
        console.warn("Wallet init", e);
      }
    })();
  }, []);

  const refreshAgent = useCallback(
    async (agentId: string) => {
      const [p, f] = await Promise.all([
        getPolicy(contractId, agentId),
        isFrozen(contractId, agentId),
      ]);
      return { policy: p, frozen: f };
    },
    [contractId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { policy: p, frozen: f } = await refreshAgent(activeAgent);
      setPolicy(p);
      setFrozen(f);
      if (p) {
        const s = yoctoToNearNumber(p.maxSingle);
        const d = yoctoToNearNumber(p.maxDaily);
        if (s != null) setLimitSingle(String(s));
        if (d != null) setLimitDaily(String(d));
      }
    } catch (e) {
      pushToast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeAgent, refreshAgent]);

  const refreshAllAgents = useCallback(async () => {
    const rows: AgentRow[] = agents.map((id) => ({
      id,
      policy: null,
      loading: true,
    }));
    setAgentRows(rows);
    const settled = await Promise.all(
      agents.map(async (id) => {
        try {
          const p = await getPolicy(contractId, id);
          return { id, policy: p, loading: false } satisfies AgentRow;
        } catch {
          return { id, policy: null, loading: false } satisfies AgentRow;
        }
      }),
    );
    setAgentRows(settled);
  }, [agents, contractId]);

  const pullChain = useCallback(async () => {
    try {
      const events = await fetchContractEvents(contractId, 30);
      setChainEvents(events);
      setStreamLive(true);
    } catch {
      setStreamLive(false);
    }
  }, [contractId]);

  useEffect(() => {
    void refresh();
    void pullChain();
    void refreshAllAgents();
    const t = setInterval(() => {
      void refresh();
      void pullChain();
    }, 12_000);
    return () => clearInterval(t);
  }, [refresh, pullChain, refreshAllAgents]);

  const maxNear = policy ? yoctoToNearNumber(policy.maxSingle) : null;

  const stats = useMemo(() => {
    const allows = decisions.filter((d) => d.allowed).length;
    const blocks = decisions.filter((d) => !d.allowed).length;
    const freezes = chainEvents.filter((e) => e.method === "freeze_agent").length;
    return { allows, blocks, freezes, txs: chainEvents.length };
  }, [decisions, chainEvents]);

  const incidents = useMemo(() => {
    return chainEvents.filter((e) =>
      ["freeze_agent", "unfreeze_agent", "update_policy", "register_agent"].includes(
        e.method,
      ),
    );
  }, [chainEvents]);

  async function connectWallet() {
    const modal = await getModal();
    modal.show();
  }

  async function runCheck(amount: number) {
    setBusy(true);
    try {
      const result = await checkTransfer(
        contractId,
        activeAgent,
        nearToYocto(amount),
      );
      setDecisions((d) =>
        [
          {
            id: crypto.randomUUID(),
            at: nowStamp(),
            allowed: result.allowed,
            amount,
            agentId: activeAgent,
            reason: result.reason,
          },
          ...d,
        ].slice(0, 40),
      );
      pushToast(
        result.allowed ? "ok" : "err",
        result.allowed
          ? `ALLOW ${amount} NEAR`
          : `BLOCK ${amount} NEAR — ${result.reason}`,
      );
      await refresh();
      return result;
    } catch (e) {
      pushToast("err", e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function ownerCall(method: string, args: Record<string, unknown>) {
    setBusy(true);
    try {
      const hash = await signFunctionCall({ contractId, method, args });
      pushToast("ok", `${method} submitted${hash ? ` · ${hash.slice(0, 10)}…` : ""}`);
      await new Promise((r) => setTimeout(r, 1500));
      await Promise.all([refresh(), pullChain(), refreshAllAgents()]);
    } catch (e) {
      pushToast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPlaybook() {
    const steps = [
      async () => {
        await refresh();
        await pullChain();
        pushToast("info", "Synced on-chain state");
      },
      async () => {
        await runCheck(1);
      },
      async () => {
        await runCheck(20);
      },
      async () => {
        if (accountId) {
          await ownerCall("freeze_agent", { agent_id: activeAgent });
        } else {
          pushToast("info", "Connect owner wallet to freeze, or use the watcher CLI");
          await pullChain();
        }
      },
      async () => {
        await runCheck(1);
      },
    ];
    for (let i = 0; i < steps.length; i++) {
      setFlowStep(i);
      await steps[i]();
    }
    setFlowStep(4);
    pushToast("ok", "Playbook complete");
  }

  function NavBtn({ id, label }: { id: Page; label: string }) {
    return (
      <button
        type="button"
        className={`nav-btn ${page === id ? "active" : ""}`}
        onClick={() => setPage(id)}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="shell">
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>

      <aside className="rail">
        <div className="rail-brand">
          <span className="mark" />
          <div>
            <strong>Guardia</strong>
            <span>Agent money defense</span>
          </div>
        </div>

        <nav className="nav">
          <NavBtn id="overview" label="Overview" />
          <NavBtn id="agents" label="Agents" />
          <NavBtn id="incidents" label="Incidents" />
          <NavBtn id="integrate" label="Integrate" />
          <NavBtn id="settings" label="Settings" />
        </nav>

        <div className="rail-section">
          <p className="rail-label">Network</p>
          <div className="rail-chip">NEAR testnet</div>
          <p className="rail-meta">Contract</p>
          <code className="rail-code">{contractId}</code>
          <p className="rail-meta">Active agent</p>
          <code className="rail-code">{activeAgent}</code>
        </div>

        <div className={`stream-pill ${streamLive ? "on" : "off"}`}>
          <span className="pulse" />
          {streamLive ? "Indexer live" : "Indexer offline"}
        </div>

        <div className="wallet-box">
          {accountId ? (
            <>
              <span className="rail-meta">Connected</span>
              <code className="rail-code">{accountId}</code>
            </>
          ) : (
            <button type="button" className="btn-primary block" onClick={() => void connectWallet()}>
              Connect owner wallet
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="hero">
          <div>
            <p className="eyebrow">AI agent treasury control · NEAR</p>
            <h1>
              Stop agent drains before value leaves the wallet
            </h1>
            <p className="hero-copy">
              Guardia is an on-chain policy layer for autonomous payments. Limits
              are enforced on NEAR; violations can freeze the agent until an owner
              intervenes.
            </p>
          </div>
          <div className="hero-side">
            <div className={`status-pill ${frozen ? "frozen" : "live"}`}>
              <span className="pulse" />
              {loading ? "Syncing" : frozen ? "Agent frozen" : "Agent live"}
            </div>
            <label className="mode-toggle">
              <input
                type="checkbox"
                checked={demoMode}
                onChange={(e) => setDemoMode(e.target.checked)}
              />
              Guided demo hints
            </label>
          </div>
        </header>

        {page === "overview" && (
          <>
            <section className="stat-row">
              <div className="stat-card">
                <span>Session allows</span>
                <strong>{stats.allows}</strong>
              </div>
              <div className="stat-card">
                <span>Session blocks</span>
                <strong className="danger-text">{stats.blocks}</strong>
              </div>
              <div className="stat-card">
                <span>Chain freezes seen</span>
                <strong>{stats.freezes}</strong>
              </div>
              <div className="stat-card">
                <span>Indexed txs</span>
                <strong>{stats.txs}</strong>
              </div>
            </section>

            {demoMode && (
              <section className="panel playbook">
                <div className="panel-header">
                  <h2>90-second playbook</h2>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void runPlaybook()}
                  >
                    {busy ? "Running…" : "Run full demo"}
                  </button>
                </div>
                <ol className="playbook-steps">
                  {["Sync", "Baseline 1 NEAR", "Attack 20 NEAR", "Freeze", "Verify"].map(
                    (label, i) => (
                      <li key={label} className={i <= flowStep ? "done" : ""}>
                        {label}
                      </li>
                    ),
                  )}
                </ol>
              </section>
            )}

            <div className="workspace">
              <section className="panel">
                <div className="panel-header">
                  <h2>Policy surface</h2>
                  <button type="button" className="btn-ghost sm" disabled={busy} onClick={() => void refresh()}>
                    Refresh
                  </button>
                </div>
                {loading ? (
                  <div className="skeleton-grid">
                    <div className="skeleton" />
                    <div className="skeleton" />
                    <div className="skeleton" />
                    <div className="skeleton" />
                  </div>
                ) : (
                  <div className="metric-grid">
                    <div className="metric">
                      <label>Max single</label>
                      <strong>{policy ? formatNear(policy.maxSingle) : "Unregistered"}</strong>
                    </div>
                    <div className="metric">
                      <label>Max daily</label>
                      <strong>{policy ? formatNear(policy.maxDaily) : "—"}</strong>
                    </div>
                    <div className="metric">
                      <label>Freeze</label>
                      <strong className={frozen ? "danger-text" : "ok-text"}>
                        {frozen ? "TRUE" : "FALSE"}
                      </strong>
                    </div>
                    <div className="metric">
                      <label>Agent</label>
                      <strong className="small-mono">{activeAgent}</strong>
                    </div>
                  </div>
                )}

                <div className="owner-actions">
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busy}
                    onClick={() => void ownerCall("freeze_agent", { agent_id: activeAgent })}
                  >
                    Freeze agent
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => void ownerCall("unfreeze_agent", { agent_id: activeAgent })}
                  >
                    Unfreeze
                  </button>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2>Policy check console</h2>
                </div>
                <p className="panel-copy">
                  Evaluates a proposed transfer size against on-chain rules. This does
                  <strong> not</strong> move funds — agents should call this before paying.
                </p>
                <div className="probe-input">
                  <input
                    type="number"
                    min={0}
                    value={customNear}
                    onChange={(e) => setCustomNear(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void runCheck(Number(customNear) || 0)}
                  >
                    Evaluate
                  </button>
                </div>
                <div className={`risk-inline ${riskTone(Number(customNear) || 0, maxNear)}`}>
                  <span>Projected risk vs limit</span>
                  <strong>{maxNear != null ? `${maxNear} NEAR cap` : "No policy"}</strong>
                </div>
                <div className="quick-actions">
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void runCheck(1)}>
                    1 NEAR
                  </button>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void runCheck(5)}>
                    5 NEAR
                  </button>
                  <button type="button" className="btn-danger" disabled={busy} onClick={() => void runCheck(20)}>
                    20 NEAR attack
                  </button>
                </div>
              </section>

              <section className="panel wide">
                <div className="panel-header">
                  <h2>Session decisions</h2>
                </div>
                <div className="feed">
                  {decisions.length === 0 ? (
                    <div className="empty">No probes yet. Run Evaluate or the playbook.</div>
                  ) : (
                    decisions.map((d) => (
                      <article key={d.id} className={`event ${d.allowed ? "allow" : "block"}`}>
                        <div className="event-tag">{d.allowed ? "allow" : "block"}</div>
                        <div className="event-body">
                          <strong>
                            {d.amount} NEAR · {d.agentId}
                          </strong>
                          <span>
                            {d.at} · {d.reason}
                          </span>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {page === "agents" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Protected agents</h2>
              <button type="button" className="btn-ghost sm" onClick={() => void refreshAllAgents()}>
                Refresh all
              </button>
            </div>
            <div className="table">
              <div className="table-head">
                <span>Agent</span>
                <span>Max single</span>
                <span>Status</span>
                <span />
              </div>
              {agentRows.map((row) => (
                <div key={row.id} className="table-row">
                  <code>{row.id}</code>
                  <span>
                    {row.loading
                      ? "…"
                      : row.policy
                        ? formatNear(row.policy.maxSingle)
                        : "Not registered"}
                  </span>
                  <span className={row.policy?.frozen ? "danger-text" : "ok-text"}>
                    {row.loading ? "…" : row.policy?.frozen ? "Frozen" : row.policy ? "Live" : "—"}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost sm"
                    onClick={() => {
                      setActiveAgent(row.id);
                      setPage("overview");
                      pushToast("info", `Active agent → ${row.id}`);
                    }}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>

            <div className="form-block">
              <h3>Register agent</h3>
              <p className="panel-copy">Owner-signed. Adds on-chain policy with default limits.</p>
              <div className="probe-input">
                <input
                  placeholder="agent-name.testnet"
                  value={registerId}
                  onChange={(e) => setRegisterId(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !registerId}
                  onClick={async () => {
                    await ownerCall("register_agent", { agent_id: registerId.trim() });
                    rememberAgent(registerId.trim());
                    const next = loadKnownAgents();
                    setAgents(next);
                    saveKnownAgents(next);
                    setRegisterId("");
                  }}
                >
                  Register
                </button>
              </div>
            </div>

            <div className="form-block">
              <h3>Update limits for active agent</h3>
              <div className="dual-input">
                <label>
                  Max single (NEAR)
                  <input value={limitSingle} onChange={(e) => setLimitSingle(e.target.value)} />
                </label>
                <label>
                  Max daily (NEAR)
                  <input value={limitDaily} onChange={(e) => setLimitDaily(e.target.value)} />
                </label>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  void ownerCall("update_policy", {
                    agent_id: activeAgent,
                    max_single_transfer: nearToYocto(limitSingle),
                    max_daily_volume: nearToYocto(limitDaily),
                  })
                }
              >
                Save policy
              </button>
            </div>
          </section>
        )}

        {page === "incidents" && (
          <section className="panel">
            <div className="panel-header">
              <h2>On-chain incidents & ops</h2>
              <button type="button" className="btn-ghost sm" onClick={() => void pullChain()}>
                Pull stream
              </button>
            </div>
            <p className="panel-copy">
              Derived from indexed transactions to {contractId}. Freeze, unfreeze, register,
              and policy updates appear here.
            </p>
            <div className="chain-feed">
              {incidents.length === 0 ? (
                <div className="empty">
                  No management txs indexed yet. Freeze an agent to populate this feed.
                </div>
              ) : (
                incidents.map((ev) => (
                  <article key={ev.id} className={`chain-event ${ev.status}`}>
                    <div className="chain-meta">
                      <span className="chain-method">{ev.method}</span>
                      <span className="chain-time">{formatEventTime(ev.at)}</span>
                    </div>
                    <strong>{ev.summary}</strong>
                    {ev.eventName && (
                      <span className="chain-nep">NEP-297 · {ev.eventName}</span>
                    )}
                    <a className="chain-link" href={ev.explorerUrl} target="_blank" rel="noreferrer">
                      {ev.txHash.slice(0, 18)}… ↗
                    </a>
                  </article>
                ))
              )}
            </div>
          </section>
        )}

        {page === "integrate" && (
          <section className="panel integrate">
            <h2 className="page-title">Integrate Guardia into an agent</h2>
            <p className="panel-copy">
              Real use case: every autonomous payment path calls Guardia <em>before</em> moving
              funds. If blocked, do not pay. If repeatedly blocked, the owner freeze path stops
              further damage.
            </p>
            <div className="integrate-grid">
              <div className="integrate-card">
                <h3>1. Check policy</h3>
                <pre>{`near view ${contractId} check_transfer \
  '{"agent_id":"${activeAgent}","amount":"1000000000000000000000000"}'`}</pre>
              </div>
              <div className="integrate-card">
                <h3>2. Watcher auto-freeze</h3>
                <pre>{`cd watcher
GUARDIA_CONTRACT=${contractId} \
GUARDIA_AGENT=${activeAgent} \
GUARDIA_NEAR=20 \
npm run live`}</pre>
              </div>
              <div className="integrate-card">
                <h3>3. Agent rule</h3>
                <ul>
                  <li>Call <code>check_transfer</code> with yocto amount as a string</li>
                  <li>Only execute the payment if <code>allowed === true</code></li>
                  <li>On block, alert ops / wait for unfreeze</li>
                </ul>
              </div>
              <div className="integrate-card">
                <h3>4. Sequence</h3>
                <pre>{`Agent intent
   → Guardia check_transfer
       → ALLOW → send payment
       → BLOCK → abort
           → watcher freeze_agent
           → owner investigates`}</pre>
              </div>
            </div>
          </section>
        )}

        {page === "settings" && (
          <section className="panel">
            <h2 className="page-title">Settings</h2>
            <div className="form-block">
              <h3>Contract account</h3>
              <div className="probe-input">
                <input
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    saveContractId(contractId.trim());
                    pushToast("ok", "Contract saved");
                    void refresh();
                    void pullChain();
                  }}
                >
                  Save
                </button>
              </div>
            </div>
            <div className="form-block">
              <h3>Known agents (local)</h3>
              <p className="panel-copy">Stored in this browser. Used by the Agents page.</p>
              <pre>{JSON.stringify(agents, null, 2)}</pre>
            </div>
            <div className="form-block">
              <h3>Wallet</h3>
              <p className="panel-copy">
                Connect the contract owner (e.g. skar.testnet) via MyNearWallet testnet to sign
                freeze, unfreeze, register, and policy updates.
              </p>
              <button type="button" className="btn-primary" onClick={() => void connectWallet()}>
                {accountId ? "Switch wallet" : "Connect wallet"}
              </button>
            </div>
          </section>
        )}

        <footer className="footer-note">
          Guardia · policy checks are read-only views; freezes are owner-signed txs on{" "}
          <code>{contractId}</code>.{" "}
          <a href="https://github.com/Daveboycyber/guardia" target="_blank" rel="noreferrer">
            Source
          </a>
        </footer>
      </main>
    </div>
  );
}
