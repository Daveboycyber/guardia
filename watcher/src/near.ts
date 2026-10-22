import { connect, keyStores, KeyPair } from "near-api-js";

const TESTNET_RPC = "https://rpc.testnet.near.org";
const NETWORK = "testnet";

type RpcResponse = {
  result?: { result?: number[] };
  error?: { message?: string; data?: unknown };
};

export async function viewCall<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const body = {
    jsonrpc: "2.0",
    id: "guardia",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    },
  };

  const res = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as RpcResponse;
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }
  const bytes = json.result?.result ?? [];
  const text = Buffer.from(bytes).toString("utf8");
  return JSON.parse(text) as T;
}

/** Signed function call as GUARDIA_OWNER (must be contract owner). */
export async function changeCall(
  contractId: string,
  method: string,
  args: Record<string, unknown>,
  options: { ownerId: string; privateKey: string; gas?: string },
): Promise<string> {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(options.privateKey as `ed25519:${string}`);
  await keyStore.setKey(NETWORK, options.ownerId, keyPair);

  const near = await connect({
    networkId: NETWORK,
    keyStore,
    nodeUrl: TESTNET_RPC,
  });
  const account = await near.account(options.ownerId);
  const result = await account.functionCall({
    contractId,
    methodName: method,
    args,
    gas: BigInt(options.gas ?? "30000000000000"),
    attachedDeposit: 0n,
  });
  const hash =
    typeof result === "object" && result && "transaction" in result
      ? (result as { transaction?: { hash?: string } }).transaction?.hash
      : undefined;
  return hash ?? "ok";
}
