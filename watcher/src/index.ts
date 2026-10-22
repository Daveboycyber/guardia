import { checkTransfer, DEFAULT_POLICY, ONE_NEAR, type Policy } from "./policy.ts";
import { viewCall } from "./near.ts";

type Proposed = { agent: string; amountNear: number; label: string };

const DEMO: Proposed[] = [
  { agent: "agent.testnet", amountNear: 1, label: "normal agent payment" },
  { agent: "agent.testnet", amountNear: 20, label: "oversized drain attempt" },
  { agent: "unknown.testnet", amountNear: 1, label: "unregistered agent" },
];

function nearToYocto(n: number): bigint {
  return BigInt(n) * ONE_NEAR;
}

function runDemo() {
  const policies = new Map<string, Policy>();
  policies.set("agent.testnet", { ...DEFAULT_POLICY });

  console.log("Guardia demo \u2014 local policy mirror (no chain required)\n");
  for (const tx of DEMO) {
    const policy = policies.get(tx.agent) ?? DEFAULT_POLICY;
    const decision = checkTransfer(policies.has(tx.agent), policy, nearToYocto(tx.amountNear));
    const verdict = decision.allowed ? "ALLOW" : "BLOCK";
    console.log(`${verdict}  ${tx.amountNear} NEAR  ${tx.label}`);
    console.log(`       ${decision.reason}\n`);
    if (!decision.allowed && tx.amountNear > 10 && policies.has(tx.agent)) {
      policies.set(tx.agent, { ...policy, frozen: true });
      console.log(`FREEZE  ${tx.agent} after suspicious flow\n`);
    }
  }

  const frozen = policies.get("agent.testnet")!;
  const after = checkTransfer(true, frozen, nearToYocto(1));
  console.log(`${after.allowed ? "ALLOW" : "BLOCK"}  1 NEAR  after freeze`);
  console.log(`       ${after.reason}`);
}

async function watchLive() {
  const contractId = process.env.GUARDIA_CONTRACT;
  const agentId = process.env.GUARDIA_AGENT;
  const amount = process.env.GUARDIA_AMOUNT ?? "1000000000000000000000000";
  if (!contractId || !agentId) {
    console.error("Set GUARDIA_CONTRACT and GUARDIA_AGENT (testnet account ids).");
    console.error("Or run: npm run demo");
    process.exit(1);
  }

  const decision = await viewCall<[boolean, string]>(contractId, "check_transfer", {
    agent_id: agentId,
    amount,
  });
  console.log(decision[0] ? "ALLOW" : "BLOCK", decision[1]);
}

const demo = process.argv.includes("--demo") || !process.env.GUARDIA_CONTRACT;
if (demo && !process.env.GUARDIA_CONTRACT) {
  runDemo();
} else if (process.argv.includes("--demo")) {
  runDemo();
} else {
  watchLive().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
