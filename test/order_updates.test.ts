import assert from "node:assert/strict";
import test from "node:test";
import { decideOrderUpdate, orderUpdateSchema } from "../src/order_updates.js";

test("a paid checkout is accepted and produces a customer update", () => {
  const input = orderUpdateSchema.parse({
    orderId: "ord_1042",
    customerId: "customer_7",
    event: "checkout_paid",
    channel: "email",
  });

  assert.deepEqual(decideOrderUpdate(input, null), {
    accepted: true,
    notifyCustomer: true,
    nextExpectedEvent: "fulfillment_started",
  });
});

test("a receipt cannot arrive before fulfillment starts", () => {
  const input = orderUpdateSchema.parse({
    orderId: "ord_1042",
    customerId: "customer_7",
    event: "receipt_sent",
    channel: "email",
  });

  assert.deepEqual(decideOrderUpdate(input, "checkout_paid"), {
    accepted: false,
    notifyCustomer: false,
    nextExpectedEvent: "fulfillment_started",
  });
});
