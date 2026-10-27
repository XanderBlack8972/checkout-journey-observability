import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai.js";
import { decideOrderUpdate, orderUpdateSchema, type OrderUpdate } from "./order_updates.js";

const orderState = new Map<string, OrderUpdate["event"]>();

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function recordUpdate(update: OrderUpdate): Promise<void> {
  await infrai.metrics.report(
    {
      type: "counter",
      name: "commerce.order_update.accepted",
      value: 1,
      tags: { event: update.event, channel: update.channel },
    },
    `order-update:${update.orderId}:${update.event}:metric`,
  );
}

async function handleUpdate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const update = orderUpdateSchema.parse(await readJson(request));
    const previous = orderState.get(update.orderId) ?? null;
    const decision = decideOrderUpdate(update, previous);
    if (!decision.accepted) {
      json(response, 409, { decision, orderId: update.orderId });
      return;
    }

    await recordUpdate(update);
    orderState.set(update.orderId, update.event);
    json(response, 202, { decision, orderId: update.orderId });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      json(response, 400, { error: "invalid_order_update" });
      return;
    }
    if (error instanceof InfraiError && error.status < 500) {
      json(response, error.status, { error: error.code });
      return;
    }

    const failure = error instanceof Error ? error : new Error("Unknown checkout update failure");
    const eventId = request.headers["x-event-id"] ?? "unidentified-event";
    try {
      await infrai.errors.capture(
        {
          message: failure.message,
          level: "error",
          fingerprint: ["checkout-service", "order-update"],
          exception: failure.stack ?? failure.message,
          context: { eventId },
        },
        `order-update:${eventId}:error`,
      );
    } catch (captureError) {
      console.error("Could not record checkout failure", captureError);
    }
    json(response, 500, { error: "order_update_failed" });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true, service: "checkout-journey" });
    return;
  }
  if (request.method === "POST" && request.url === "/order-updates") {
    await handleUpdate(request, response);
    return;
  }
  json(response, 404, { error: "not_found" });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`checkout journey listening on http://localhost:${port}`));
