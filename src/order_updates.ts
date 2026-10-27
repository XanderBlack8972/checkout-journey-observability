import { z } from "zod";

export const orderUpdateSchema = z.object({
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  event: z.enum(["checkout_paid", "fulfillment_started", "receipt_sent"]),
  channel: z.enum(["email", "sms", "push"]),
});

export type OrderUpdate = z.infer<typeof orderUpdateSchema>;

const nextEvent: Record<OrderUpdate["event"], OrderUpdate["event"] | null> = {
  checkout_paid: "fulfillment_started",
  fulfillment_started: "receipt_sent",
  receipt_sent: null,
};

export type UpdateDecision = {
  accepted: boolean;
  notifyCustomer: boolean;
  nextExpectedEvent: OrderUpdate["event"] | null;
};

export function decideOrderUpdate(
  update: OrderUpdate,
  previousEvent: OrderUpdate["event"] | null,
): UpdateDecision {
  const expected = previousEvent === null ? "checkout_paid" : nextEvent[previousEvent];
  const accepted = update.event === expected;
  return {
    accepted,
    notifyCustomer: accepted && update.event !== "fulfillment_started",
    nextExpectedEvent: accepted ? nextEvent[update.event] : expected,
  };
}
