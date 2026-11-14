import {
  checkTransfer,
  DEFAULT_POLICY,
  isPolicyBreach,
  nearToYocto,
  yoctoToNear,
  type Policy,
} from "./policy.ts";
import {
  changeCallViaCli,
  checkTransferOnChain,
  credentialsExist,
  explorerTx,
  getPolicy,
  getUsage,
  listAgents,
} from "./near.ts";
import { log } from "./log.ts";

// ---------------------------------------------------------------- config

const env = process.env;
const CONTRACT = env.GUARDIA_CONTRACT ?? "skar.testnet";
const AGENT = env.GUARDIA_AGENT ?? "agent.skar.testnet";
const OWNER = env.GUARDIA_OWNER ?? "skar.testnet";
const AUTO_FREEZE = env.GUARDIA_AUTO_FREEZE !== "0";
const DRY_RUN = env.GUARDIA_DRY_RUN === "1";

function num(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function probeAmount(): { yocto: bigint; label: string } {
  if (env.GUARDIA_AMOUNT) {
    return { yocto: BigInt(env.GUARDIA_AMOUNT), label: `${env.GUARDIA_AMOUNT} yocto` };
  }
  const near = num("GUARDIA_NEAR", 1);
  return { yocto: nearToYocto(near), label: `${near} NEAR` };
}

// ---------------------------------------------------------------- freeze

type FreezeResult = { status: "frozen" | "dry_run" | "skipped" | "failed"; tx?: string };

async function freeze(agentId: string, reason: string): Promise<FreezeResult> {
  if (DRY_RUN) {
    log("warn", "would_freeze", { agent: agentId, reason, dry_run: true });
    return { status: "dry_run" };
  }
  if (!AUTO_FREEZE) {
    log("warn", "breach_reported", { agent: agentId, reason, auto_freeze: false });
    return { status: "skipped" };
  }
  if (!credentialsExist(OWNER)) {
    log("warn", "freeze_skipped", {
      agent: agentId,
      reason: `no credentials at ~/.near-credentials/testnet/${OWNER}.json`,
    });
    return { status: "skipped" };
  }
  try {
    const tx = await changeCallViaCli(CONTRACT, "freeze_agent", { agent_id: agentId }, { ownerId: OWNER });
    log("warn", "agent_frozen", { agent: agentId, reason, tx, url: explorerTx(tx) });
    return { status: "frozen", tx };
  } catch (err) {
    log("error", "freeze_failed", { agent: agentId, error: errMsg(err) });
    return { status: "failed" };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------- demo (offline)

function runDemo() {
  const steps: { agent: string; amountNear: number; label: string }[] = [
    { agent: "agent.testnet", amountNear: 1, label: "normal agent payment" },
    { agent: "agent.testnet", amountNear: 20, label: "oversized drain attempt" },
    { agent: "unknown.testnet", amountNear: 1, label: "unregistered agent" },
  ];
  const policies = new Map<string, Policy>([["agent.testnet", { ...DEFAULT_POLICY }]]);

  console.log("Guardia demo — local policy mirror (no chain required)\n");
  for (const tx of steps) {
    const policy = policies.get(tx.agent) ?? DEFAULT_POLICY;
    const amount = nearToYocto(tx.amountNear);
    const decision = checkTransfer(policies.has(tx.agent), policy, amount);
    console.log(`${decision.allowed ? "ALLOW" : "BLOCK"}  ${tx.amountNear} NEAR  ${tx.label}`);
    console.log(`       ${decision.reason}\n`);
    if (decision.allowed) {
      policies.set(tx.agent, { ...policy, spentToday: policy.spentToday + amount });
    } else if (policies.has(tx.agent) && isPolicyBreach(decision.reason)) {
      policies.set(tx.agent, { ...policy, frozen: true });
      console.log(`FREEZE  ${tx.agent} after suspicious flow\n`);
    }
  }
  const after = checkTransfer(true, policies.get("agent.testnet")!, nearToYocto(1));
  console.log(`${after.allowed ? "ALLOW" : "BLOCK"}  1 NEAR  after freeze`);
  console.log(`       ${after.reason}`);
}

// ---------------------------------------------------------------- live (one-shot)

async function runLive() {
  const { yocto, label } = probeAmount();
  const [allowed, reason] = await checkTransferOnChain(CONTRACT, AGENT, yocto);
  log(allowed ? "info" : "warn", allowed ? "allow" : "block", {
    agent: AGENT,
    contract: CONTRACT,
    amount: label,
    reason,
  });
  if (allowed || !isPolicyBreach(reason)) return;

  const res = await freeze(AGENT, reason);
  if (res.status === "failed") process.exit(1);
  if (res.status === "frozen") {
    const [ok, why] = await checkTransferOnChain(CONTRACT, AGENT, nearToYocto(1));
    log("info", "verify", { agent: AGENT, amount: "1 NEAR", decision: ok ? "ALLOW" : "BLOCK", reason: why });
  }
}

// ---------------------------------------------------------------- watch (continuous)

type AgentState = { spent: bigint; frozen: boolean; day: string; alerted?: string };

/**
 * Continuous defense loop. Each tick, for every agent:
 *  - budget threshold: spent_today >= GUARDIA_FREEZE_AT_PCT of max_daily → freeze
 *  - velocity: spend committed since last tick > GUARDIA_MAX_TICK_NEAR → freeze
 *  - probe (optional): check_transfer(GUARDIA_PROBE_NEAR) blocked by a limit → freeze
 */
async function runWatch() {
  const intervalMs = num("GUARDIA_INTERVAL", 15) * 1000;
  const freezeAtPct = num("GUARDIA_FREEZE_AT_PCT", 90);
  const maxTickNear = env.GUARDIA_MAX_TICK_NEAR; // default: agent's max_single
  const probeNear = env.GUARDIA_PROBE_NEAR ? Number(env.GUARDIA_PROBE_NEAR) : null;
  const maxTicks = num("GUARDIA_MAX_TICKS", 0); // 0 = forever
  const fixedAgents = env.GUARDIA_AGENTS?.split(",").map((s) => s.trim()).filter(Boolean);

  log("info", "watch_start", {
    contract: CONTRACT,
    owner: OWNER,
    agents: fixedAgents?.join(",") ?? "list_agents()",
    interval_s: intervalMs / 1000,
    freeze_at_pct: freezeAtPct,
    max_tick_near: maxTickNear ?? "max_single",
    probe_near: probeNear ?? "off",
    dry_run: DRY_RUN,
    auto_freeze: AUTO_FREEZE,
    credentials: credentialsExist(OWNER),
  });

  const state = new Map<string, AgentState>();
  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    if (stopping) process.exit(130);
    stopping = true;
    log("info", "watch_stopping");
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  for (let tick = 1; !stopping; tick++) {
    try {
      const agents = fixedAgents ?? (await listAgents(CONTRACT));
      for (const agentId of agents) {
        await inspectAgent(agentId, state, { freezeAtPct, maxTickNear, probeNear });
      }
      log("info", "tick", { n: tick, agents: agents.length });
    } catch (err) {
      // RPC hiccups must not kill the guard.
      log("error", "tick_failed", { n: tick, error: errMsg(err) });
    }
    if (maxTicks && tick >= maxTicks) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  log("info", "watch_stopped");
}

async function inspectAgent(
  agentId: string,
  state: Map<string, AgentState>,
  opts: { freezeAtPct: number; maxTickNear: string | undefined; probeNear: number | null },
) {
  const [policy, usage] = await Promise.all([getPolicy(CONTRACT, agentId), getUsage(CONTRACT, agentId)]);
  if (!policy || !usage) {
    log("warn", "agent_unregistered", { agent: agentId });
    return;
  }
  const maxSingle = BigInt(policy[0]);
  const maxDaily = BigInt(policy[1]);
  const frozen = policy[2];
  const spent = BigInt(usage[0]);
  const day = usage[2];
  const prev = state.get(agentId);
  state.set(agentId, { spent, frozen, day, alerted: frozen ? undefined : prev?.alerted });

  if (!prev) {
    log("info", "agent_seen", {
      agent: agentId,
      frozen,
      spent_today: `${yoctoToNear(spent)} NEAR`,
      max_single: `${yoctoToNear(maxSingle)} NEAR`,
      max_daily: `${yoctoToNear(maxDaily)} NEAR`,
    });
  } else if (prev.frozen !== frozen) {
    log("info", frozen ? "agent_frozen_onchain" : "agent_unfrozen_onchain", { agent: agentId });
  }
  if (prev && spent !== prev.spent && prev.day === day) {
    log("info", "spend_committed", {
      agent: agentId,
      delta: `${yoctoToNear(spent - prev.spent)} NEAR`,
      spent_today: `${yoctoToNear(spent)} NEAR`,
    });
  }
  if (frozen) return; // already contained

  const breaches: string[] = [];

  if (maxDaily > 0n && opts.freezeAtPct > 0) {
    const pct = Number((spent * 10_000n) / maxDaily) / 100;
    if (pct >= opts.freezeAtPct) {
      breaches.push(`daily budget ${pct}% used (threshold ${opts.freezeAtPct}%)`);
    }
  }

  if (prev && prev.day === day && spent > prev.spent) {
    const limit = opts.maxTickNear !== undefined ? nearToYocto(Number(opts.maxTickNear)) : maxSingle;
    const delta = spent - prev.spent;
    if (limit > 0n && delta > limit) {
      breaches.push(`velocity ${yoctoToNear(delta)} NEAR in one tick (limit ${yoctoToNear(limit)})`);
    }
  }

  if (opts.probeNear !== null) {
    const [ok, reason] = await checkTransferOnChain(CONTRACT, agentId, nearToYocto(opts.probeNear));
    if (!ok && isPolicyBreach(reason)) breaches.push(`probe ${opts.probeNear} NEAR blocked: ${reason}`);
  }

  const key = breaches.join("; ");
  if (!breaches.length) {
    state.get(agentId)!.alerted = undefined;
  } else if (prev?.alerted !== key) {
    state.get(agentId)!.alerted = key; // don't re-alert the same breach every tick
    log("warn", "breach", { agent: agentId, rules: key });
    const res = await freeze(agentId, breaches.join("; "));
    if (res.status === "frozen") state.set(agentId, { spent, frozen: true, day });
    if (res.status === "failed") state.get(agentId)!.alerted = undefined; // retry next tick
  }
}

// ---------------------------------------------------------------- chain demo (golden path)

/**
 * Golden demo path against testnet, signed with the owner's keychain:
 * unfreeze → check 1 → commit 1 → check 20 → freeze → check 1. Prints tx links.
 */
async function runChainDemo() {
  if (!credentialsExist(OWNER)) {
    throw new Error(`chain demo needs owner credentials at ~/.near-credentials/testnet/${OWNER}.json`);
  }
  const txs: { step: string; tx: string }[] = [];
  const call = async (step: string, method: string, args: Record<string, unknown>) => {
    const tx = await changeCallViaCli(CONTRACT, method, args, { ownerId: OWNER });
    txs.push({ step, tx });
    log("info", "tx", { step, method, tx, url: explorerTx(tx) });
  };
  const check = async (near: number) => {
    const [ok, reason] = await checkTransferOnChain(CONTRACT, AGENT, nearToYocto(near));
    log(ok ? "info" : "warn", ok ? "allow" : "block", { amount: `${near} NEAR`, reason });
    return ok;
  };
  const usage = async () => {
    const u = await getUsage(CONTRACT, AGENT);
    if (u) log("info", "usage", { spent_today: `${yoctoToNear(u[0])} NEAR`, remaining: `${yoctoToNear(u[1])} NEAR` });
  };

  log("info", "chain_demo_start", { contract: CONTRACT, agent: AGENT, owner: OWNER });
  const policy = await getPolicy(CONTRACT, AGENT);
  if (!policy) throw new Error(`${AGENT} is not registered on ${CONTRACT}`);
  if (policy[2]) await call("reset", "unfreeze_agent", { agent_id: AGENT });

  await usage();
  if (!(await check(1))) throw new Error("expected 1 NEAR to be allowed — check limits / daily budget");
  await call("commit 1 NEAR", "commit_spend", { agent_id: AGENT, amount: nearToYocto(1).toString() });
  await usage();
  if (await check(20)) log("warn", "unexpected_allow", { amount: "20 NEAR" });
  await call("freeze", "freeze_agent", { agent_id: AGENT });
  if (await check(1)) log("warn", "unexpected_allow", { amount: "1 NEAR after freeze" });
  if (env.GUARDIA_RESET === "1") await call("cleanup", "unfreeze_agent", { agent_id: AGENT });

  console.log("\nTransactions:");
  for (const t of txs) console.log(`  ${t.step.padEnd(14)} ${explorerTx(t.tx)}`);
}

// ---------------------------------------------------------------- entry

const mode = process.argv.find((a) => ["--demo", "--live", "--watch", "--chain-demo"].includes(a)) ?? "--demo";
const runners: Record<string, () => unknown> = {
  "--demo": runDemo,
  "--live": runLive,
  "--watch": runWatch,
  "--chain-demo": runChainDemo,
};

Promise.resolve()
  .then(runners[mode])
  .catch((err) => {
    log("error", "fatal", { error: errMsg(err) });
    process.exit(1);
  });
