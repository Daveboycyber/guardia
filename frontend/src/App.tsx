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
  getUsage,
  isFrozen,
  listAgents,
  nearToYocto,
  usagePercent,
  type PolicyView,
  type UsageView,
  yoctoToNearNumber,
} from "./lib/near";
import { pushToast, subscribeToasts, type Toast } from "./lib/toast";
import {
  clearPendingTx,
  getAccountId,
  getModal,
  getSelector,
  loadPendingTx,
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
  usage: UsageView;
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
  const [usage, setUsage] = useState<UsageView>(null);
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

  const refresh = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet === true;
      if (!quiet) setLoading(true);
      try {
        const [snap, u, chainAgents] = await Promise.all([
          refreshAgent(activeAgent),
          getUsage(contractId, activeAgent),
          listAgents(contractId).catch(() => [] as string[]),
        ]);
        setPolicy(snap.policy);
        setFrozen(snap.frozen);
        setUsage(u);
        if (snap.policy) {
          const s = yoctoToNearNumber(snap.policy.maxSingle);
          const d = yoctoToNearNumber(snap.policy.maxDaily);
          if (s != null) setLimitSingle(String(s));
          if (d != null) setLimitDaily(String(d));
        }
        if (chainAgents.length) {
          const known = loadKnownAgents();
          // Only update agents state when the set actually changed (prevents effect churn)
          const merged = Array.from(new Set([...chainAgents, ...known]));
          const prev = new Set(known);
          const changed =
            merged.length !== prev.size || merged.some((id) => !prev.has(id));
          if (changed) {
            setAgents(merged);
            saveKnownAgents(merged);
          }
        }
      } catch (e) {
        if (!quiet) {
          pushToast("err", e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [activeAgent, contractId, refreshAgent],
  );

  const refreshAllAgents = useCallback(async () => {
    // Snapshot current agents so we don't fight concurrent setAgents from refresh()
    const ids = agents;
    if (!ids.length) {
      setAgentRows([]);
      return;
    }
    setAgentRows((prev) => {
      // Keep previous data while loading to avoid row flicker
      const map = new Map(prev.map((r) => [r.id, r]));
      return ids.map((id) => {
        const existing = map.get(id);
        return existing
          ? { ...existing, loading: true }
          : { id, policy: null, usage: null, loading: true };
      });
    });
    const settled = await Promise.all(
      ids.map(async (id) => {
        try {
          const [p, u] = await Promise.all([
            getPolicy(contractId, id),
            getUsage(contractId, id),
          ]);
          return { id, policy: p, usage: u, loading: false } satisfies AgentRow;
        } catch {
          return { id, policy: null, usage: null, loading: false } satisfies AgentRow;
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

  // Clear surface when switching agent so we never flash the previous agent's limits
  useEffect(() => {
    setPolicy(null);
    setUsage(null);
    setFrozen(null);
  }, [activeAgent]);

  // Initial + activeAgent/contract change: full load once
  useEffect(() => {
    void refresh();
    void pullChain();
  }, [refresh, pullChain]);

  // Poll quietly — never flips loading, so Policy Surface stays stable
  useEffect(() => {
    const t = setInterval(() => {
      void refresh({ quiet: true });
      void pullChain();
    }, 20_000);
    return () => clearInterval(t);
  }, [refresh, pullChain]);

  // Agents table only when the list itself changes (not on every quiet refresh)
  useEffect(() => {
    void refreshAllAgents();
  }, [agents, contractId]); // intentionally not refreshAllAgents — avoid identity churn

  useEffect(() => {
    const pending = loadPendingTx();
    if (!pending || Date.now() - pending.at > 15 * 60_000) {
      if (pending) clearPendingTx();
      return;
    }
    let cancelled = false;
    void (async () => {
      await new Promise((r) => setTimeout(r, 1200));
      if (cancelled) return;
      try {
        await refresh({ quiet: true });
        await pullChain();
        clearPendingTx();
        pushToast("ok", `${pending.method} confirmed (wallet return)`);
      } catch {
        /* keep pending */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, pullChain]);

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
    if (!accountId) {
      pushToast("info", "Connect skar.testnet first, then retry");
      await connectWallet();
      return;
    }
    setBusy(true);
    try {
      const hash = await signFunctionCall({
        contractId,
        method,
        args,
        gas: "50000000000000",
      });
      pushToast(
        "ok",
        `${method} submitted${hash ? ` · ${hash.slice(0, 10)}…` : ""}`,
      );
      await new Promise((r) => setTimeout(r, 2000));
      await Promise.all([
        refresh({ quiet: true }),
        pullChain(),
        refreshAllAgents(),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/redirected to sign|wallet return/i.test(msg)) {
        pushToast("info", msg);
      } else {
        pushToast("err", msg);
      }
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
              <p className="rail-meta">Connected</p>
              <code className="rail-code">{accountId}</code>
              <button type="button" className="btn-ghost sm" onClick={() => void connectWallet()}>
                Switch
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void connectWallet()}>
              Connect wallet
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        {page === "overview" && (
          <>
            <header className="page-head">
              <div>
                <h1>Overview</h1>
                <p className="page-sub">
                  Live policy surface + decision log for the active agent.
                </p>
              </div>
              <div className="page-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setDemoMode((v) => !v)}
                >
                  {demoMode ? "Hide demo" : "Demo mode"}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  {loading ? "Syncing" : frozen ? "Agent frozen" : "Agent live"}
                </button>
              </div>
            </header>

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
                {/* Only skeleton on true first load — never blank the tile on quiet/poll refreshes */}
                {loading && !policy && !usage ? (
                  <div className="skeleton-grid">
                    <div className="skeleton" />
                    <div className="skeleton" />
                    <div className="skeleton" />
                    <div className="skeleton" />
                  </div>
                ) : (
                  <div className={`metric-grid${loading ? " is-refreshing" : ""}`}>
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
                        {frozen == null ? "…" : frozen ? "TRUE" : "FALSE"}
                      </strong>
                    </div>
                    <div className="metric">
                      <label>Spent today</label>
                      <strong>{usage ? formatNear(usage.spent) : "—"}</strong>
                    </div>
                    <div className="metric">
                      <label>Remaining today</label>
                      <strong className="ok-text">{usage ? formatNear(usage.remaining) : "—"}</strong>
                    </div>
                    <div
                      className={`usage-track ${
                        policy && usage
                          ? usagePercent(usage.spent, policy.maxDaily) >= 80
                            ? "hot"
                            : usagePercent(usage.spent, policy.maxDaily) >= 50
                              ? "warn"
                              : ""
                          : ""
                      }`}
                    >
                      <div
                        style={{
                          width: `${
                            policy && usage ? usagePercent(usage.spent, policy.maxDaily) : 0
                          }%`,
                        }}
                      />
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
                  <h2>Probe transfer</h2>
                </div>
                <div className="probe-row">
                  {[0.5, 1, 5, 10, 20].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`btn-ghost probe ${riskTone(n, maxNear)}`}
                      disabled={busy}
                      onClick={() => void runCheck(n)}
                    >
                      {n} Ⓝ
                    </button>
                  ))}
                </div>
                <div className="probe-input">
                  <input
                    value={customNear}
                    onChange={(e) => setCustomNear(e.target.value)}
                    placeholder="Custom NEAR"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void runCheck(Number(customNear) || 0)}
                  >
                    Check
                  </button>
                </div>
                <div className="decision-list">
                  {decisions.length === 0 && (
                    <p className="empty">No probes yet — try 1 Ⓝ then 20 Ⓝ.</p>
                  )}
                  {decisions.map((d) => (
                    <div key={d.id} className={`decision ${d.allowed ? "ok" : "bad"}`}>
                      <span className="decision-time">{d.at}</span>
                      <strong>{d.allowed ? "ALLOW" : "BLOCK"}</strong>
                      <span>{d.amount} Ⓝ</span>
                      <span className="decision-reason">{d.reason}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}

        {page === "agents" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Agents</h2>
              <button type="button" className="btn-ghost sm" onClick={() => void refreshAllAgents()}>
                Refresh table
              </button>
            </div>
            <div className="agent-table">
              <div className="agent-head">
                <span>Agent</span>
                <span>Max single</span>
                <span>Max daily</span>
                <span>Spent today</span>
                <span>Status</span>
                <span></span>
              </div>
              {agentRows.map((row) => (
                <div key={row.id} className="agent-row">
                  <code>{row.id}</code>
                  <span>
                    {row.loading
                      ? "…"
                      : row.policy
                        ? formatNear(row.policy.maxSingle)
                        : "—"}
                  </span>
                  <span>
                    {row.loading
                      ? "…"
                      : row.policy
                        ? formatNear(row.policy.maxDaily)
                        : "—"}
                  </span>
                  <span>
                    {row.loading ? "…" : row.usage ? formatNear(row.usage.spent) : "—"}
                  </span>
                  <span>
                    {row.loading ? "…" : row.policy?.frozen ? "Frozen" : row.policy ? "Live" : "—"}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost sm"
                    onClick={() => {
                      setActiveAgent(row.id);
                      rememberAgent(row.id);
                      setPage("overview");
                    }}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
            <div className="form-block">
              <h3>Register agent</h3>
              <div className="probe-input">
                <input
                  value={registerId}
                  onChange={(e) => setRegisterId(e.target.value)}
                  placeholder="agent.testnet"
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !registerId.trim()}
                  onClick={() =>
                    void ownerCall("register_agent", {
                      agent_id: registerId.trim(),
                      max_single: nearToYocto(Number(limitSingle) || 10),
                      max_daily: nearToYocto(Number(limitDaily) || 50),
                    })
                  }
                >
                  Register
                </button>
              </div>
            </div>
          </section>
        )}

        {page === "incidents" && (
          <section className="panel">
            <div className="panel-header">
              <h2>Incidents & chain events</h2>
              <button type="button" className="btn-ghost sm" onClick={() => void pullChain()}>
                Refresh stream
              </button>
            </div>
            <div className="event-list">
              {incidents.length === 0 && (
                <p className="empty">No freeze / policy events indexed yet.</p>
              )}
              {incidents.map((e) => (
                <div key={e.id} className="event-row">
                  <span className="event-time">{formatEventTime(e.timestamp)}</span>
                  <strong>{e.method}</strong>
                  <code>{e.signer || e.receiver || "—"}</code>
                </div>
              ))}
            </div>
            <h3 className="subhead">Full recent stream</h3>
            <div className="event-list">
              {chainEvents.map((e) => (
                <div key={e.id} className="event-row muted">
                  <span className="event-time">{formatEventTime(e.timestamp)}</span>
                  <span>{e.method}</span>
                  <code>{e.signer || "—"}</code>
                </div>
              ))}
            </div>
          </section>
        )}

        {page === "integrate" && (
          <section className="panel">
            <h2 className="page-title">Integrate</h2>
            <p className="panel-copy">
              Call <code>check_transfer</code> before any agent spend. On BLOCK, stop the payment
              and optionally trigger freeze via the watcher or owner wallet.
            </p>
            <div className="integrate-grid">
              <div className="integrate-card">
                <h3>1. View call</h3>
                <pre>{`near view ${contractId} check_transfer '{
  "agent_id": "agent.testnet",
  "amount": "1000000000000000000000000"
}'`}</pre>
              </div>
              <div className="integrate-card">
                <h3>2. Commit spend (owner path)</h3>
                <pre>{`near call ${contractId} commit_spend '{
  "agent_id": "agent.testnet",
  "amount": "1000000000000000000000000"
}' --accountId owner.testnet`}</pre>
              </div>
              <div className="integrate-card">
                <h3>3. Watcher auto-freeze</h3>
                <ul>
                  <li>Monitors failed checks / policy violations</li>
                  <li>Signs <code>freeze_agent</code> as owner</li>
                  <li>Daily cap counts</li>
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
              <h3>Agents</h3>
              <p className="panel-copy">
                Loaded from on-chain <code>list_agents</code>, then cached in this browser.
              </p>
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