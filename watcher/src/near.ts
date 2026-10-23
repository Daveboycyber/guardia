import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
/** Official public rpc.testnet.near.org is deprecated; FastNear is recommended. */
const TESTNET_RPC =
  process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";

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
    throw new Error(
      typeof json.error.message === "string"
        ? json.error.message
        : JSON.stringify(json.error),
    );
  }
  const bytes = json.result?.result ?? [];
  const text = Buffer.from(bytes).toString("utf8");
  return JSON.parse(text) as T;
}

export function defaultCredentialsPath(ownerId: string): string {
  return join(homedir(), ".near-credentials", "testnet", `${ownerId}.json`);
}

export function credentialsExist(ownerId: string): boolean {
  return existsSync(defaultCredentialsPath(ownerId));
}

export async function changeCallViaCli(
  contractId: string,
  method: string,
  args: Record<string, unknown>,
  options: { ownerId: string },
): Promise<string> {
  const jsonArgs = JSON.stringify(args);
  const { stdout, stderr } = await execFileAsync(
    "near",
    [
      "contract",
      "call-function",
      "as-transaction",
      contractId,
      method,
      "json-args",
      jsonArgs,
      "prepaid-gas",
      "30.0 Tgas",
      "attached-deposit",
      "0 NEAR",
      "sign-as",
      options.ownerId,
      "network-config",
      "testnet",
      "sign-with-legacy-keychain",
      "send",
    ],
    {
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    },
  );
  const out = `${stdout}\n${stderr}`;
  const txMatch =
    out.match(/Transaction ID:\s*(\S+)/i) ??
    out.match(
      /https:\/\/explorer\.testnet\.near\.org\/transactions\/(\S+)/i,
    );
  if (out.toLowerCase().includes("error") && !txMatch) {
    throw new Error(out.slice(-800));
  }
  return txMatch?.[1] ?? "ok";
}

export function loadPrivateKeyFromCredentials(ownerId: string): string | null {
  const path = defaultCredentialsPath(ownerId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw) as { private_key?: string };
    const key = data.private_key?.trim();
    return key || null;
  } catch {
    return null;
  }
}
