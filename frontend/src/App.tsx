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
  explorerTx,
  fetchContractEvents,
  formatEventTime,
  type ChainEvent,
} from "./lib/events";
import {
  checkTransfer,
  formatNear,
  getPolicy,
  getUsage,
  humanReason,
  isFrozen,
  listAgents,
  nearToYocto,
  previewDecision,
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
  amount: string;
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

type IncidentFilter = "all" | "freeze" | "policy" | "spend";

const EVENT_LABELS: Record<string, string> = {
  freeze_agent: "Agent frozen",
  unfreeze_agent: "Agent unfrozen",
  update_policy: "Limits changed",
  register_agent: "Agent registered",
  commit_spend: "Spend recorded",
};

const FILTER_METHODS: Record<IncidentFilter, string[]> = {
  all: ["freeze_agent", "unfreeze_agent", "update_policy", "register_agent", "commit_spend"],
  freeze: ["freeze_agent", "unfreeze_agent"],
  policy: ["update_policy", "register_agent"],
  spend: ["commit_spend"],
};

function agoLabel(at: number | null, now: number) {
  if (at == null) return "never";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
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
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [incidentFilter, setIncidentFilter] = useState<IncidentFilter>("all");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
        setLastSync(Date.now());
        if (snap.policy) {
          const s = yoctoToNearNumber(snap.policy.maxSingle);
          const d = yoctoToNearNumber(snap.policy.maxDaily);
          if (s != null) setLimitSingle(String(s));
          if (d != null) setLimitDaily(String(d));
        }
        if (chainAgents.length) {
          const known = loadKnownAgents();
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
    const ids = agents;
    if (!ids.length) {
      setAgentRows([]);
      return;
    }
    setAgentRows((prev) => {
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

  useEffect(() => {
    setPolicy(null);
    setUsage(null);
    setFrozen(null);
  }, [activeAgent]);

  useEffect(() => {
    void refresh();
    void pullChain();
  }, [refresh, pullChain]);

  useEffect(() => {
    const t = setInterval(() => {
      void refresh({ quiet: true });
      void pullChain();
    }, 20_000);
    return () => clearInterval(t);
  }, [refresh, pullChain]);

  useEffect(() => {
    void refreshAllAgents();
  }, [agents, contractId]);

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
  const budgetPct =
    policy && usage ? usagePercent(usage.spent, policy.maxDaily) : 0;
  const budgetTone = budgetPct >= 80 ? "hot" : budgetPct >= 50 ? "warn" : "";

  const stats = useMemo(() => {
    const allows = decisions.filter((d) => d.allowed).length;
    const blocks = decisions.filter((d) => !d.allowed).length;
    const freezes = chainEvents.filter((e) => e.method === "freeze_agent").length;
    return { allows, blocks, freezes, txs: chainEvents.length };
  }, [decisions, chainEvents]);

  const incidents = useMemo(() => {
    const methods = FILTER_METHODS[incidentFilter];
    return chainEvents.filter((e) => methods.includes(e.method));
  }, [chainEvents, incidentFilter]);

  const preview = useMemo(
    () => previewDecision(policy, usage, nearToYocto(customNear)),
    [policy, usage, customNear],
  );

  const posture = useMemo(() => {
    if (!policy) {
      return {
        level: "unknown" as const,
        title: loading ? "Reading policy…" : "Agent not registered",
        detail: loading
          ? "Fetching limits and usage from the contract."
          : `${activeAgent} has no policy on ${contractId}. Register it on the Agents page.`,
        advice: [] as string[],
      };
    }
    const single = formatNear(policy.maxSingle);
    const left = usage ? formatNear(usage.remaining) : formatNear(policy.maxDaily);
    const recentBlocks = decisions.slice(0, 5).filter((d) => !d.allowed).length;
    if (frozen) {
      return {
        level: "frozen" as const,
        title: "Frozen — all spending blocked",
        detail: `${activeAgent} cannot spend until the owner unfreezes it.`,
        advice: [
          "Review the Incidents page to see what triggered the freeze.",
          "Unfreeze only after the cause is fixed.",
        ],
      };
    }
    const advice: string[] = [];
    if (budgetPct >= 80) advice.push("Daily budget almost used up — consider freezing until tomorrow.");
    if (recentBlocks >= 2) advice.push(`${recentBlocks} of the last 5 probes were blocked — the agent may be misbehaving.`);
    if ((yoctoToNearNumber(policy.maxSingle) ?? 0) * 2 > (yoctoToNearNumber(policy.maxDaily) ?? 0))
      advice.push("Single limit is over half the daily budget — two payments could drain it.");
    const level = budgetPct >= 80 || recentBlocks >= 2 ? ("risk" as const) : budgetPct >= 50 || advice.length ? ("watch" as const) : ("secure" as const);
    const title =
      level === "secure" ? "Protected" : level === "watch" ? "Protected — keep an eye on it" : "At risk";
    return {
      level,
      title,
      detail: `${activeAgent} can spend up to ${single} per payment, with ${left} left today (${budgetPct}% of budget used).`,
      advice,
    };
  }, [policy, usage, frozen, loading, decisions, budgetPct, activeAgent, contractId]);

  async function connectWallet() {
    const modal = await getModal();
    modal.show();
  }

  async function runCheck(amount: number | string) {
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
            amount: String(amount),
            agentId: activeAgent,
            reason: humanReason(result.reason),
          },
          ...d,
        ].slice(0, 40),
      );
      pushToast(
        result.allowed ? "ok" : "err",
        result.allowed
          ? `ALLOW ${amount} NEAR`
          : `BLOCK ${amount} NEAR — ${humanReason(result.reason)}`,
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
        `${method} submitted${hash ? ` · ${hash.slice(0, 10)}… (view tx)` : ""}`,
        hash ? explorerTx(hash) : undefined,
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
        await ownerCall("commit_spend", {
          agent_id: activeAgent,
          amount: nearToYocto(1),
        });
      },
      async () => {
        await runCheck(20);
        await ownerCall("commit_spend", {
          agent_id: activeAgent,
          amount: nearToYocto(20),
        });
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
            {t.href ? (
              <a href={t.href} target="_blank" rel="noreferrer">
                {t.message}
              </a>
            ) : (
              t.message
            )}
          </div>
        ))}
      </div>

      <aside className="rail">
        <div className="rail-brand">
          <img className="mark" src="/guardia-mark.svg" alt="" width={32} height={32} />
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
                <span
                  className={`status-badge ${frozen ? "frozen" : policy ? "live" : "idle"}`}
                  title={`Last synced ${agoLabel(lastSync, now)}`}
                >
                  <span className="dot" />
                  {loading && !policy ? "Syncing" : frozen ? "Frozen" : policy ? "Active" : "Unregistered"}
                  <small>· synced {agoLabel(lastSync, now)}</small>
                </span>
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
                  {["Sync", "Commit 1 NEAR", "Attack 20 NEAR", "Freeze", "Verify"].map(
                    (label, i) => (
                      <li key={label} className={i <= flowStep ? "done" : ""}>
                        {label}
                      </li>
                    ),
                  )}
                </ol>
              </section>
            )}

            <section className={`posture ${posture.level}`}>
              <div className="posture-icon" aria-hidden="true">
                <img src="/guardia-mark.svg" alt="" width={40} height={40} />
              </div>
              <div className="posture-body">
                <span className="posture-kicker">Guardian verdict</span>
                <h2>{posture.title}</h2>
                <p>{posture.detail}</p>
                {posture.advice.length > 0 && (
                  <ul>
                    {posture.advice.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <div className="workspace">
              <section className="panel">
                <div className="panel-header">
                  <h2>Policy surface</h2>
                  <button type="button" className="btn-ghost sm" disabled={busy} onClick={() => void refresh()}>
                    Refresh
                  </button>
                </div>
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
                    <div className={`budget-needle ${budgetTone}`}>
                      <div className="budget-needle-head">
                        <span>Daily budget</span>
                        <strong>{budgetPct}%</strong>
                      </div>
                      <div className="usage-track">
                        <div style={{ width: `${Math.min(100, budgetPct)}%` }} />
                      </div>
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
                      className={`probe ${riskTone(n, maxNear)}`}
                      disabled={busy}
                      onClick={() => void runCheck(n)}
                    >
                      <span className="amt">{n}</span>
                      <span className="unit">NEAR</span>
                    </button>
                  ))}
                </div>
                <div className="probe-input">
                  <input
                    value={customNear}
                    onChange={(e) => setCustomNear(e.target.value)}
                    inputMode="decimal"
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => void runCheck(customNear || "0")}
                  >
                    Check
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void ownerCall("commit_spend", {
                        agent_id: activeAgent,
                        amount: nearToYocto(customNear || "0"),
                      })
                    }
                  >
                    Commit spend
                  </button>
                </div>
                {preview && Number(customNear) > 0 && (
                  <p className={`live-preview ${preview.allowed ? "ok" : "bad"}`}>
                    <strong>{preview.allowed ? "Would allow" : "Would block"}</strong>{" "}
                    {customNear} NEAR · {preview.reason}
                  </p>
                )}
                <div className="decision-list">
                  {decisions.length === 0 ? (
                    <p className="empty">No session decisions yet — run a probe.</p>
                  ) : (
                    decisions.map((d) => (
                      <div key={d.id} className={`decision ${d.allowed ? "ok" : "bad"}`}>
                        <span className="decision-time">{d.at}</span>
                        <strong>{d.allowed ? "ALLOW" : "BLOCK"}</strong>
                        <span className="decision-amt">{d.amount} NEAR</span>
                        <span className="decision-reason">{d.reason}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}

        {page === "agents" && (
          <section className="panel">
            <h2 className="page-title">Agents</h2>
            <div className="agent-table">
              <div className="agent-head">
                <span>Agent</span>
                <span>Max single</span>
                <span>Max daily</span>
                <span>Spent</span>
                <span>Frozen</span>
                <span />
              </div>
              {agentRows.map((row) => (
                <div key={row.id} className="agent-row">
                  <code>{row.id}</code>
                  <span>{row.policy ? formatNear(row.policy.maxSingle) : "…"}</span>
                  <span>{row.policy ? formatNear(row.policy.maxDaily) : "…"}</span>
                  <span>{row.usage ? formatNear(row.usage.spent) : "…"}</span>
                  <span className={row.policy?.frozen ? "danger-text" : "ok-text"}>
                    {row.policy == null ? "…" : row.policy.frozen ? "YES" : "no"}
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
                  placeholder="agent.example.testnet"
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !registerId.trim()}
                  onClick={() =>
                    void ownerCall("register_agent", { agent_id: registerId.trim() })
                  }
                >
                  Register
                </button>
              </div>
              <p className="panel-copy">New agents start at 10 NEAR per payment and 50 NEAR per day.</p>
            </div>
            <div className="form-block">
              <h3>
                Limits for <code>{activeAgent}</code>
              </h3>
              <div className="dual-input">
                <label>
                  Max single (NEAR)
                  <input value={limitSingle} inputMode="decimal" onChange={(e) => setLimitSingle(e.target.value)} />
                </label>
                <label>
                  Max daily (NEAR)
                  <input value={limitDaily} inputMode="decimal" onChange={(e) => setLimitDaily(e.target.value)} />
                </label>
              </div>
              {Number(limitSingle) > Number(limitDaily) && (
                <p className="live-preview bad">Single limit is higher than the daily budget, so the daily budget will apply first.</p>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !policy || !(Number(limitSingle) > 0) || !(Number(limitDaily) > 0)}
                onClick={() =>
                  void ownerCall("update_policy", {
                    agent_id: activeAgent,
                    max_single_transfer: nearToYocto(limitSingle),
                    max_daily_volume: nearToYocto(limitDaily),
                  })
                }
              >
                Update limits
              </button>
            </div>
          </section>
        )}

        {page === "incidents" && (
          <section className="panel">
            <h2 className="page-title">Incidents / chain events</h2>
            <div className="filter-row">
              {(["all", "freeze", "policy", "spend"] as IncidentFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chip ${incidentFilter === f ? "active" : ""}`}
                  onClick={() => setIncidentFilter(f)}
                >
                  {{ all: "All", freeze: "Freezes", policy: "Policy", spend: "Spend" }[f]}
                </button>
              ))}
            </div>
            <div className="event-list">
              {incidents.length === 0 ? (
                <p className="empty">No matching events indexed yet.</p>
              ) : (
                incidents.map((e) => (
                  <div key={e.id} className={`event-row ev-${e.method}`}>
                    <span>{formatEventTime(e.at)}</span>
                    <strong>{EVENT_LABELS[e.method] ?? e.method}</strong>
                    <span>{e.summary}</span>
                    <a className="chain-link" href={e.explorerUrl} target="_blank" rel="noreferrer">
                      {e.txHash.slice(0, 10)}…
                    </a>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {page === "integrate" && (
          <section className="panel">
            <h2 className="page-title">Integrate</h2>
            <div className="integrate-grid">
              <div className="integrate-card">
                <h3>1. View check</h3>
                <pre>{`check_transfer({
  agent_id,
  amount: yocto
}) → [allowed, reason]`}</pre>
              </div>
              <div className="integrate-card">
                <h3>2. Commit spend</h3>
                <pre>{`commit_spend({
  agent_id,
  amount: yocto
})`}</pre>
              </div>
              <div className="integrate-card">
                <h3>3. On BLOCK</h3>
                <ul>
                  <li>Abort the agent payment</li>
                  <li>Optional: freeze_agent</li>
                  <li>Alert ops / wait for unfreeze</li>
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
