export type ToastKind = "ok" | "err" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  href?: string;
};

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

/** near-api-js / wallet-selector still schema only ed25519+secp256k1;
 *  accounts with ml-dsa-65 keys throw a long Borsh enum error that is noise for Guardia. */
function isKeyTypeSchemaNoise(message: string): boolean {
  return (
    /keyType/i.test(message) &&
    /enum schema|ed25519Key|secp256k1Key/i.test(message)
  );
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

export function pushToast(kind: ToastKind, message: string, href?: string) {
  if (isKeyTypeSchemaNoise(message)) {
    if (typeof console !== "undefined") {
      console.warn("[guardia] suppressed keyType schema noise", message.slice(0, 120));
    }
    return;
  }
  const id = crypto.randomUUID();
  toasts = [{ id, kind, message, href }, ...toasts].slice(0, 5);
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, href ? 9000 : 4500);
}
