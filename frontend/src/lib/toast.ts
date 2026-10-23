export type ToastKind = "ok" | "err" | "info";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  listener([...toasts]);
  return () => listeners.delete(listener);
}

export function pushToast(kind: ToastKind, message: string) {
  const id = crypto.randomUUID();
  toasts = [{ id, kind, message }, ...toasts].slice(0, 5);
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 4500);
}
