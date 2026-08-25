import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const rateLimitMaxRequests = positiveIntegerFromEnvironment("MDQ_RATE_LIMIT_MAX_REQUESTS");

createApp({
  rateLimitOptions: rateLimitMaxRequests ? { maxRequests: rateLimitMaxRequests } : undefined,
}).listen(port, () => {
  console.log(`Map Data Quality provider listening on :${port}`);
});

function positiveIntegerFromEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer when set.`);
  }
  return Number(value);
}
