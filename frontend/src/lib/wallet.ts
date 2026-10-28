import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { NETWORK_ID, getRpcUrl } from "./config";

let selectorPromise: Promise<WalletSelector> | null = null;
let modal: WalletSelectorModal | null = null;

const PENDING_KEY = "guardia_pending_tx";

export type PendingTx = {
  method: string;
  at: number;
};

export function loadPendingTx(): PendingTx | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingTx;
  } catch {
    return null;
  }
}

export function clearPendingTx() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function stashPendingTx(method: string) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ method, at: Date.now() } satisfies PendingTx),
    );
  } catch {
    /* ignore */
  }
}

/** Same-origin RPC so wallet-selector never hits public endpoints from the browser. */
function walletNodeUrl(): string {
  return getRpcUrl();
}

export async function getSelector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const { setupWalletSelector } = await import("@near-wallet-selector/core");
      const { setupMyNearWallet } = await import(
        "@near-wallet-selector/my-near-wallet"
      );
      const nodeUrl = walletNodeUrl();
      return setupWalletSelector({
        network: {
          networkId: NETWORK_ID,
          nodeUrl,
          helperUrl: "https://helper.testnet.near.org",
          explorerUrl: "https://explorer.testnet.near.org",
          indexerUrl: "https://api-testnet.nearblocks.io",
        },
        modules: [
          setupMyNearWallet({
            walletUrl: "https://testnet.mynearwallet.com",
          }),
        ],
      });
    })();
  }
  return selectorPromise;
}

export async function getModal(): Promise<WalletSelectorModal> {
  const selector = await getSelector();
  if (!modal) {
    const { setupModal } = await import("@near-wallet-selector/modal-ui");
    modal = setupModal(selector, {
      contractId: "skar.testnet",
      description:
        "Connect the Guardia owner account to freeze, unfreeze, and manage agents.",
    });
  }
  return modal;
}

export async function getAccountId(): Promise<string | null> {
  try {
    const selector = await getSelector();
    if (!selector.isSignedIn()) return null;
    const accounts = selector.store.getState().accounts;
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

export async function signFunctionCall(opts: {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  gas?: string;
}): Promise<string | undefined> {
  const selector = await getSelector();
  if (!selector.isSignedIn()) {
    const m = await getModal();
    m.show();
    throw new Error("Connect a wallet first (owner account)");
  }

  stashPendingTx(opts.method);

  const wallet = await selector.wallet();
  try {
    const result = await wallet.signAndSendTransaction({
      receiverId: opts.contractId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: opts.method,
            args: opts.args,
            gas: opts.gas ?? "30000000000000",
            deposit: "0",
          },
        },
      ],
    });
    clearPendingTx();
    if (result && typeof result === "object" && "transaction" in result) {
      const tx = (result as { transaction?: { hash?: string } }).transaction;
      return tx?.hash;
    }
    if (typeof result === "string") return result;
    return undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/redirect|popup|user rejected|cancelled/i.test(msg)) {
      throw new Error("Redirected to sign — return to this tab after approving");
    }
    clearPendingTx();
    throw e;
  }
}