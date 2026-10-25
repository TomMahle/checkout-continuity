import type { PaymentBehaviour } from "./schema";

export interface ChargeRequest {
  /** Lets a real processor dedupe: one charge per session, whatever the key. */
  sessionId: string;
  amountCents: number;
  idempotencyKey: string;
  behaviour: PaymentBehaviour;
}

export type ChargeResult =
  { ok: true; chargeId: string } | { ok: false; reason: string };

/** The seam where a real processor (Stripe, Adyen, ...) would plug in. */
export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** For a charge that succeeded after we had already given up on it. */
  refund(chargeId: string): Promise<void>;
}

export interface StubPaymentOptions {
  /** How long `slow_success` takes. */
  slowMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createStubPayment(options: StubPaymentOptions = {}) {
  const slowMs = options.slowMs ?? 3000;
  const sleep =
    options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let charges = 0;
  const refunds: string[] = [];

  const gateway: PaymentGateway = {
    async charge(request) {
      if (request.behaviour === "fail") {
        return { ok: false, reason: "card_declined" };
      }
      if (request.behaviour === "slow_success") await sleep(slowMs);
      charges += 1;
      return { ok: true, chargeId: `ch_${charges}_${request.idempotencyKey}` };
    },
    async refund(chargeId) {
      refunds.push(chargeId);
    },
  };
  return { gateway, refunds };
}
