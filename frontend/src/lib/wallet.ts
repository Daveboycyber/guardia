import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { NETWORK_ID, RPC_URL } from "./config";

let selectorPromise: Promise<WalletSelector> | null = null;
let modal: WalletSelectorModal | null = null;

export async function getSelector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = setupWalletSelector({
      network: {
        networkId: NETWORK_ID,
        nodeUrl: RPC_URL,
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
  }
  return selectorPromise;
}

export async function getModal(): Promise<WalletSelectorModal> {
  const selector = await getSelector();
  if (!modal) {
    modal = setupModal(selector, {
      contractId: "skar.testnet",
      description: "Connect the Guardia owner account to freeze, unfreeze, and manage agents.",
    });
  }
  return modal;
}

export async function getAccountId(): Promise<string | null> {
  const selector = await getSelector();
  if (!selector.isSignedIn()) return null;
  const accounts = await selector.store.getState().accounts;
  return accounts[0]?.accountId ?? null;
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
  const wallet = await selector.wallet();
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
  // Wallet implementations vary on return shape
  if (result && typeof result === "object" && "transaction" in result) {
    const tx = (result as { transaction?: { hash?: string } }).transaction;
    return tx?.hash;
  }
  if (typeof result === "string") return result;
  return undefined;
}
