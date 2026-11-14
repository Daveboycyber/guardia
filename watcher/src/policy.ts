export const ONE_NEAR = 10n ** 24n;

export type Policy = {
  maxSingle: bigint;
  maxDaily: bigint;
  frozen: boolean;
  spentToday: bigint;
};

export const DEFAULT_POLICY: Policy = {
  maxSingle: 10n * ONE_NEAR,
  maxDaily: 50n * ONE_NEAR,
  frozen: false,
  spentToday: 0n,
};

/** Mirrors Policy::evaluate in the contract so the demo matches on-chain rules. */
export function checkTransfer(
  registered: boolean,
  policy: Policy,
  amount: bigint,
): { allowed: boolean; reason: string } {
  if (!registered) return { allowed: false, reason: "Agent not registered" };
  if (policy.frozen) return { allowed: false, reason: "Agent is frozen" };
  if (amount > policy.maxSingle) {
    return {
      allowed: false,
      reason: `Amount ${amount} exceeds max_single_transfer ${policy.maxSingle}`,
    };
  }
  if (policy.spentToday + amount > policy.maxDaily) {
    return {
      allowed: false,
      reason: `Amount ${amount} would exceed max_daily_volume ${policy.maxDaily} (spent today ${policy.spentToday})`,
    };
  }
  return { allowed: true, reason: "Allowed" };
}

/** Breach reasons that justify an automatic freeze (not "already frozen" / "unknown agent"). */
export function isPolicyBreach(reason: string): boolean {
  return reason.includes("exceeds") || reason.includes("would exceed");
}

export function nearToYocto(n: number): bigint {
  // Support fractional NEAR without float drift past 6 decimals.
  return (BigInt(Math.round(n * 1e6)) * ONE_NEAR) / 1_000_000n;
}

export function yoctoToNear(y: bigint | string): string {
  const v = typeof y === "string" ? BigInt(y) : y;
  const whole = v / ONE_NEAR;
  const frac = (v % ONE_NEAR) * 1000n / ONE_NEAR;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(3, "0").replace(/0+$/, "")}`;
}
