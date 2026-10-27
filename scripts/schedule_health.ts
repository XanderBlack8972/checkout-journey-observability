import { infrai } from "../src/infrai.js";

const publicBaseUrl = process.env.PUBLIC_BASE_URL;
if (!publicBaseUrl) throw new Error("Set PUBLIC_BASE_URL to the deployed service origin");

const task = new URL("/health", publicBaseUrl).toString();
const result = await infrai.cron.create(
  { cron_expr: "*/5 * * * *", task },
  `checkout-health:${task}`,
);

console.log(JSON.stringify({ scheduled: true, jobId: result.job_id, task }, null, 2));
