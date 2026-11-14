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

function walletNodeUrl(): string {
  return getRpcUrl();
}

function rewriteWalletError(msg: string): string {
  if (/keyType/i.test(msg) && /enum schema|ed25519Key|secp256k1Key|ml-dsa/i.test(msg)) {
    return (
      "Wallet library could not decode a key on this account. " +
      "Use Meteor Wallet (browser extension) with the full-access ed25519 key for skar.testnet, " +
      "or sign freeze / unfreeze / commit via near CLI."
    );
  }
  if (/access key .+ doesn't exist/i.test(msg)) {
    return (
      "This wallet does not control that access key. " +
      "Disconnect, connect Meteor with skar.testnet, and approve the request with a full-access key."
    );
  }
  return msg;
}

export async function getSelector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const { setupWalletSelector } = await import("@near-wallet-selector/core");
      const { setupMeteorWallet } = await import(
        "@near-wallet-selector/meteor-wallet"
      );
      const { setupHereWallet } = await import(
        "@near-wallet-selector/here-wallet"
      );
      const { setupNightly } = await import("@near-wallet-selector/nightly");
      const { setupHotWallet } = await import(
        "@near-wallet-selector/hot-wallet"
      );

      const nodeUrl = walletNodeUrl();
      return setupWalletSelector({
        network: {
          networkId: NETWORK_ID,
          nodeUrl,
          helperUrl: "https://helper.testnet.near.org",
          explorerUrl: "https://testnet.nearblocks.io",
          indexerUrl: "https://api-testnet.nearblocks.io",
        },
        // MyNearWallet no longer accepts new app connections (sunset).
        // Meteor is the recommended migration path and is listed first.
        modules: [
          setupMeteorWallet(),
          setupHereWallet(),
          setupHotWallet(),
          setupNightly(),
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
        "Connect skar.testnet with Meteor Wallet (full-access ed25519) to freeze, unfreeze, and commit spend.",
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
    const raw = e instanceof Error ? e.message : String(e);
    if (/redirect|popup|user rejected|cancelled|user closed/i.test(raw)) {
      throw new Error("Sign request closed — approve in Meteor and try again");
    }
    clearPendingTx();
    throw new Error(rewriteWalletError(raw));
  }
}
