import { ONE_NEAR, RPC_URL } from "./config";

export type PolicyView = {
  maxSingle: string;
  maxDaily: string;
  frozen: boolean;
} | null;

export type UsageView = {
  spent: string;
  remaining: string;
  epochDay: string;
} | null;

async function viewCall<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "guardia-ui",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = (await res.json()) as {
    result?: { result?: number[] };
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }
  const bytes = json.result?.result ?? [];
  const text = new TextDecoder().decode(Uint8Array.from(bytes));
  return JSON.parse(text) as T;
}

export async function getPolicy(
  contractId: string,
  agentId: string,
): Promise<PolicyView> {
  const raw = await viewCall<[string, string, boolean] | null>(
    contractId,
    "get_policy",
    { agent_id: agentId },
  );
  if (!raw) return null;
  return { maxSingle: raw[0], maxDaily: raw[1], frozen: raw[2] };
}

export async function getUsage(
  contractId: string,
  agentId: string,
): Promise<UsageView> {
  const raw = await viewCall<[string, string, string] | null>(
    contractId,
    "get_usage",
    { agent_id: agentId },
  );
  if (!raw) return null;
  return { spent: raw[0], remaining: raw[1], epochDay: raw[2] };
}

export async function isFrozen(
  contractId: string,
  agentId: string,
): Promise<boolean> {
  return viewCall<boolean>(contractId, "is_frozen", { agent_id: agentId });
}

export async function listAgents(contractId: string): Promise<string[]> {
  return viewCall<string[]>(contractId, "list_agents", {});
}

export async function checkTransfer(
  contractId: string,
  agentId: string,
  amountYocto: string,
): Promise<{ allowed: boolean; reason: string }> {
  const [allowed, reason] = await viewCall<[boolean, string]>(
    contractId,
    "check_transfer",
    { agent_id: agentId, amount: amountYocto },
  );
  return { allowed, reason };
}

export function nearToYocto(near: number | string): string {
  const n = typeof near === "string" ? Number(near) : near;
  return (BigInt(Math.floor(n)) * ONE_NEAR).toString();
}

export function formatNear(yocto: string): string {
  try {
    const v = BigInt(yocto);
    const whole = v / ONE_NEAR;
    const frac = v % ONE_NEAR;
    if (frac === 0n) return `${whole} NEAR`;
    const fracStr = frac.toString().padStart(24, "0").replace(/0+$/, "");
    return `${whole}.${fracStr} NEAR`;
  } catch {
    return yocto;
  }
}

export function yoctoToNearNumber(yocto: string): number | null {
  try {
    return Number(BigInt(yocto) / ONE_NEAR);
  } catch {
    return null;
  }
}

export function usagePercent(spentYocto: string, maxDailyYocto: string): number {
  try {
    const spent = BigInt(spentYocto);
    const max = BigInt(maxDailyYocto);
    if (max === 0n) return 0;
    return Number((spent * 100n) / max);
  } catch {
    return 0;
  }
}