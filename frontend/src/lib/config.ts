export const DEFAULT_CONTRACT = "skar.testnet";
export const DEFAULT_AGENT = "agent.skar.testnet";
export const NETWORK_ID = "testnet";
export const RPC_URL =
  import.meta.env.VITE_NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
export const ONE_NEAR = 10n ** 24n;

const AGENTS_KEY = "guardia.knownAgents";
const CONTRACT_KEY = "guardia.contractId";

export function loadContractId(): string {
  return localStorage.getItem(CONTRACT_KEY) ?? DEFAULT_CONTRACT;
}

export function saveContractId(id: string) {
  localStorage.setItem(CONTRACT_KEY, id);
}

export function loadKnownAgents(): string[] {
  try {
    const raw = localStorage.getItem(AGENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return [DEFAULT_AGENT];
}

export function saveKnownAgents(agents: string[]) {
  const unique = [...new Set(agents.filter(Boolean))];
  localStorage.setItem(AGENTS_KEY, JSON.stringify(unique));
}

export function rememberAgent(agentId: string) {
  const list = loadKnownAgents();
  if (!list.includes(agentId)) {
    saveKnownAgents([...list, agentId]);
  }
}
