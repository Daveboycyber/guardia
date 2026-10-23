export type ChainEvent = {
  id: string;
  at: number;
  method: string;
  signer: string;
  status: "success" | "failure" | "unknown";
  eventName?: string;
  summary: string;
  txHash: string;
  explorerUrl: string;
};

const INDEXER_BASE =
  import.meta.env.VITE_NEARBLOCKS_URL ?? "/api/nearblocks";

type NearblocksTxn = {
  transaction_hash?: string;
  hash?: string;
  signer_account_id?: string;
  block_timestamp?: string | number;
  outcomes?: {
    status?: boolean;
    outcome?: { logs?: string[] };
  };
  actions?: Array<{ action?: string; method?: string }>;
  outcomes_agg?: { transaction_status?: string };
};

function explorerTx(hash: string) {
  return `https://explorer.testnet.near.org/transactions/${hash}`;
}

function parseEventJson(logs: string[] | undefined): string | undefined {
  if (!logs?.length) return undefined;
  for (const line of logs) {
    const idx = line.indexOf("EVENT_JSON:");
    if (idx === -1) continue;
    try {
      const payload = JSON.parse(line.slice(idx + "EVENT_JSON:".length)) as {
        event?: string;
      };
      return payload.event;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function methodFromTxn(txn: NearblocksTxn): string {
  for (const a of txn.actions ?? []) {
    if (a.method) return a.method;
    if (a.action && a.action !== "FUNCTION_CALL") return a.action;
  }
  return "transaction";
}

function summarize(method: string, eventName: string | undefined, signer: string) {
  if (eventName) return `${eventName.replace(/_/g, " ")} · by ${signer}`;
  const map: Record<string, string> = {
    freeze_agent: `Freeze by ${signer}`,
    unfreeze_agent: `Unfreeze by ${signer}`,
    register_agent: `Register by ${signer}`,
    update_policy: `Policy update by ${signer}`,
    new: `Init by ${signer}`,
  };
  return map[method] ?? `${method} · ${signer}`;
}

function normalizeTxn(txn: NearblocksTxn): ChainEvent | null {
  const txHash = txn.transaction_hash ?? txn.hash;
  if (!txHash) return null;
  const signer = txn.signer_account_id ?? "unknown";
  const method = methodFromTxn(txn);
  const eventName = parseEventJson(txn.outcomes?.outcome?.logs);
  const tsRaw = txn.block_timestamp;
  let at = Date.now();
  if (typeof tsRaw === "string" || typeof tsRaw === "number") {
    const n = Number(tsRaw);
    at = n > 1e14 ? Math.floor(n / 1e6) : n > 1e12 ? n : n * 1000;
  }
  const statusStr = String(txn.outcomes_agg?.transaction_status ?? "").toLowerCase();
  const fail = txn.outcomes?.status === false || statusStr.includes("fail");
  const ok =
    txn.outcomes?.status === true ||
    statusStr.includes("success");
  return {
    id: txHash,
    at,
    method,
    signer,
    status: fail ? "failure" : ok ? "success" : "unknown",
    eventName,
    summary: summarize(method, eventName, signer),
    txHash,
    explorerUrl: explorerTx(txHash),
  };
}

export async function fetchContractEvents(
  accountId: string,
  limit = 25,
): Promise<ChainEvent[]> {
  const url = `${INDEXER_BASE}/v1/account/${accountId}/txns?per_page=${limit}&order=desc`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Indexer ${res.status}`);
  const json = (await res.json()) as { txns?: NearblocksTxn[]; data?: NearblocksTxn[] };
  const list = json.txns ?? json.data ?? [];
  return list
    .map(normalizeTxn)
    .filter((e): e is ChainEvent => e != null)
    .sort((a, b) => b.at - a.at);
}

export function formatEventTime(at: number): string {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
