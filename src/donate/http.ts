import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { ROOT } from "../config.js";
import {
  createDonateCheckout,
  donateEnabled,
  handleDonateWebhook,
  parseDonateAmount,
} from "./stripe.js";

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readRawBody(
  req: http.IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function applePayAssociationBody(config: AppConfig): string | Buffer | null {
  if (config.stripeApplePayAssociation) return config.stripeApplePayAssociation;
  const candidates = [
    path.join(ROOT, "public", ".well-known", "apple-developer-merchantid-domain-association"),
    path.join(ROOT, "data", "apple-developer-merchantid-domain-association"),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return fs.readFileSync(filePath);
    }
  }
  return null;
}

/** Returns true if this request was a donate route. */
export async function handleDonateRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: AppConfig,
  pathname: string,
): Promise<boolean> {
  if (pathname === "/.well-known/apple-developer-merchantid-domain-association") {
    const body = applePayAssociationBody(config);
    if (!body) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end("Not found");
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(body);
    return true;
  }

  if (pathname === "/api/donate/config" && req.method === "GET") {
    const enabled = donateEnabled(config);
    sendJson(res, 200, {
      enabled,
      publishableKey: enabled ? config.stripePublishableKey : null,
    });
    return true;
  }

  if (pathname === "/api/donate/intent" && req.method === "POST") {
    if (!donateEnabled(config)) {
      sendJson(res, 503, { error: "unconfigured" });
      return true;
    }
    try {
      const raw = await readRawBody(req, 8_192);
      const body = JSON.parse(raw.toString("utf8") || "{}") as {
        amountCents?: unknown;
        monthly?: unknown;
      };
      const amountCents = parseDonateAmount(body.amountCents);
      if (amountCents == null) {
        sendJson(res, 400, { error: "invalid_amount" });
        return true;
      }
      const monthly = body.monthly === true;
      const checkout = await createDonateCheckout(config, amountCents, monthly);
      sendJson(res, 200, {
        clientSecret: checkout.clientSecret,
        paymentIntentId: checkout.paymentIntentId,
        subscriptionId: checkout.subscriptionId,
      });
    } catch (err) {
      console.error("Donate intent error:", err);
      sendJson(res, 500, { error: "intent_failed" });
    }
    return true;
  }

  if (pathname === "/api/donate/webhook" && req.method === "POST") {
    const signatureHeader = req.headers["stripe-signature"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    if (!signature) {
      sendJson(res, 400, { error: "missing_signature" });
      return true;
    }
    try {
      const raw = await readRawBody(req, 262_144);
      await handleDonateWebhook(config, raw, signature);
      sendJson(res, 200, { received: true });
    } catch (err) {
      console.error("Donate webhook error:", err);
      const message = err instanceof Error ? err.message : "";
      const status =
        message === "stripe_webhook_unconfigured" ? 503 : 400;
      sendJson(res, status, { error: "webhook_failed" });
    }
    return true;
  }

  return false;
}
