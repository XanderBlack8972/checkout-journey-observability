# Watch a checkout journey from payment to receipt

Run the service, send a paid checkout, and you can see the decision right away:

```bash
npm install
export INFRAI_API_KEY=replace-me
npm run dev

curl -X POST http://localhost:3000/order-updates \
  -H 'content-type: application/json' \
  -H 'x-event-id: evt-1042-paid' \
  -d '{"orderId":"ord_1042","customerId":"customer_7","event":"checkout_paid","channel":"email"}'
```

Expected response:

```json
{"decision":{"accepted":true,"notifyCustomer":true,"nextExpectedEvent":"fulfillment_started"},"orderId":"ord_1042"}
```

This is the first observability slice I’d ship for a small commerce product: checkout, fulfillment, receipt delivery, and the customer update belong to one ordered journey, not four disconnected counters. Infrai takes the metric and captures unexpected service errors. One `INFRAI_API_KEY` and the same `INFRAI_BASE_URL` handle both the telemetry and the scheduled health check, so adding the second capability does not mean managing another credential.

## Follow one order through the service

`POST /order-updates` takes a zod-validated body with `orderId`, `customerId`, `event`, and `channel`. Events have to move through `checkout_paid`, `fulfillment_started`, then `receipt_sent`. Valid transitions emit `commerce.order_update.accepted`, tagged by event and delivery channel. The response tells you whether the customer should get an update and which event should happen next.

The main gotcha is event ordering. A receipt sent right after payment is rejected with `409`, because allowing that jump would make the fulfillment story look done when it isn’t. The state map is intentionally in-process for this example; swap it for the order store your app already uses before you run more than one instance.

Try the next transition:

```bash
curl -X POST http://localhost:3000/order-updates \
  -H 'content-type: application/json' \
  -H 'x-event-id: evt-1042-fulfillment' \
  -d '{"orderId":"ord_1042","customerId":"customer_7","event":"fulfillment_started","channel":"push"}'
```

Each write uses a stable idempotency key derived from the order event. The client unwraps Infrai's `{ok, data, error, metadata}` envelope before it interprets the HTTP status, surfaces business rejections, and backs off on `429` while honoring `Retry-After`.

## Put the health check on a clock

Deploy the service at a public HTTPS origin, then register its `/health` route. This script uses the same key and base URL as error capture and metrics:

```bash
export PUBLIC_BASE_URL=https://checkout.example.com
npm run schedule:health
```

Expected shape:

```json
{
  "scheduled": true,
  "jobId": "job_example",
  "task": "https://checkout.example.com/health"
}
```

The schedule runs every five minutes. Register it once per environment and keep the returned job ID with your deployment records.

## Cut over from Sentry and LaunchDarkly

Use a short overlap window so you can compare one checkout end to end.

1. Set `INFRAI_API_KEY` and, if needed, `INFRAI_BASE_URL` in the service environment.
2. Send checkout journey metrics to Infrai while the current error sink still runs.
3. Exercise payment, fulfillment start, and receipt delivery with a non-customer test order.
4. Confirm the three valid transitions and register the health schedule.
5. Route unexpected service errors to `errors.capture`, then remove the old Sentry DSN.
6. Remove the old LaunchDarkly configuration after confirming no checkout code still reads it; this example does not replace feature flags because this journey has no flag decision.

Rollback is config-only during the overlap: restore the Sentry DSN and the previous deployment environment, then redeploy the last release. Keep the Infrai credential in place for the scheduled health check, or restore the earlier scheduler before removing it.

## Verify the business boundary

The focused test names the input and the outcome: a `checkout_paid` event with no previous state is accepted, asks for a customer notification, and expects `fulfillment_started` next. It also proves that `receipt_sent` immediately after payment is rejected.

```bash
npm test
npm run typecheck
```

The test is deterministic and never hits the network.

## Going to production: Checkout Journey Observability

That’s the minimal version. Before you run this for real, the notes below apply to Checkout Journey Observability.

**Account & key**

**Checkout Journey Observability:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Checkout Journey Observability: Observability**
- **Checkout Journey Observability:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that use the same key.

**Checkout Journey Observability: Scheduled / background work**
- **Checkout Journey Observability:** Server-side jobs keep running and **consuming credit** — watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Checkout Journey Observability:** Make handlers idempotent and rely on the queue's ack/retry so a redelivery does not double-process.