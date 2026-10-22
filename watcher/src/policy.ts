export const ONE_NEAR = 10n ** 24n;

export type Policy = {
  maxSingle: bigint;
  maxDaily: bigint;
  frozen: boolean;
};

export const DEFAULT_POLICY: Policy = {
  maxSingle: 10n * ONE_NEAR,
  maxDaily: 50n * ONE_NEAR,
  frozen: false,
};

/** Mirrors Contract::check_transfer so the demo matches on-chain rules. */
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
  return { allowed: true, reason: "Allowed" };
}
