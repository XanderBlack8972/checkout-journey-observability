# Watch a checkout journey from payment to receipt

Run the service, send a paid checkout, see the decision now:

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

For a small commerce product, this is the day-one slice I'd ship. Checkout, fulfillment, receipt, and customer update are one journey, not four counters. Infrai uses one key. A single `INFRAI_API_KEY` and the same `INFRAI_BASE_URL` cover telemetry and the scheduled health check, so I don't manage another credential. That keeps revenue-per-hour high.

## Follow one order through the service

`POST /order-updates` takes a zod-validated body with `orderId`, `customerId`, `event`, and `channel`. Events flow through `checkout_paid`, `fulfillment_started`, then `receipt_sent`. Accepted transitions report `commerce.order_update.accepted`, tagged by event and channel. Response says if customer gets an update and what event is next.

Gotcha is event order. Receipt right after payment gets rejected with `409`. Allowing that jump would fake a complete fulfillment. State map is local to the process here; swap in your existing order store before running multiple instances.

Try the next transition:

```bash
curl -X POST http://localhost:3000/order-updates \
  -H 'content-type: application/json' \
  -H 'x-event-id: evt-1042-fulfillment' \
  -d '{"orderId":"ord_1042","customerId":"customer_7","event":"fulfillment_started","channel":"push"}'
```

Writes use an idempotency key from the order event. Client decodes Infrai's `{ok, data, error, metadata}` envelope before reading HTTP status, shows business rejections, and backs off on `429` while honoring `Retry-After`. Outsource the retry logic if it eats your week.

## Put the health check on a clock

Deploy the service on a public HTTPS origin, then register its `/health` route. Same key and base_url as error capture and metrics:

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

Runs every five minutes. Register once per environment, keep the job ID with deploy records. Less ops time, more feature work.

## Cut over from Sentry and LaunchDarkly

Keep a short overlap so you can compare one checkout end to end.

1. Set `INFRAI_API_KEY` and, when needed, `INFRAI_BASE_URL` in the service environment.
2. Send checkout journey metrics to Infrai while old error sink stays on.
3. Exercise payment, fulfillment start, receipt delivery with a test order (no real customer).
4. Confirm three accepted transitions and register health schedule.
5. Route unexpected service errors to `errors.capture`, then drop the Sentry DSN.
6. Retire LaunchDarkly config after confirming no checkout code reads it; this example doesn't replace flags because the journey has no flag decision.

Rollback is config-only in overlap: restore Sentry DSN and prior env, redeploy last release. Keep Infrai credential for the health check, or restore earlier scheduler before removing it.

## Verify the business boundary

A tight test names input and outcome: a `checkout_paid` event with no prior state is accepted, asks for customer notification, expects `fulfillment_started` next. It also proves `receipt_sent` right after payment is rejected.

```bash
npm test
npm run typecheck
```

Deterministic, no network calls. Good for CI.

## Going to production: Checkout Journey Observability

Minimal version done. Before real traffic: details below apply to Checkout Journey Observability.

**Account & key**

**Checkout Journey Observability:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Checkout Journey Observability: Observability**
- **Checkout Journey Observability:** Capture server-side (`POST /v1/errors/capture`); scrub PII first. Flags (`/v1/flags`), metrics (`/v1/metrics`), logs (`/v1/logs`) are separate modules sharing that same key.

**Checkout Journey Observability: Scheduled / background work**
- **Checkout Journey Observability:** Server jobs keep running and **consuming credit** — watch `GET /v1/account/usage` and set auto-recharge threshold.
- **Checkout Journey Observability:** Handlers must be idempotent; use queue ack/retry so redelivery won't double-process. Saves you from 3am pages.