import Stripe from "stripe";
import type { AppConfig } from "../config.js";
import {
  markSubscriptionStatus,
  upsertDonation,
  type DonationInterval,
} from "./db.js";

export const DONATE_MIN_CENTS = 500;
export const DONATE_MAX_CENTS = 1_000_000;

let stripeClient: Stripe | null = null;
let monthlyProductId: string | null = null;

export function donateEnabled(config: AppConfig): boolean {
  return Boolean(config.stripeSecretKey && config.stripePublishableKey);
}

export function getStripe(config: AppConfig): Stripe | null {
  if (!config.stripeSecretKey) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(config.stripeSecretKey);
  }
  return stripeClient;
}

export function parseDonateAmount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < DONATE_MIN_CENTS || n > DONATE_MAX_CENTS) return null;
  return n;
}

type InvoiceLike = {
  id?: string;
  payment_intent?: string | { id?: string; client_secret?: string | null } | null;
  confirmation_secret?: { client_secret?: string | null } | null;
  subscription?: string | { id?: string } | null;
  amount_paid?: number;
  currency?: string;
  parent?: {
    subscription_details?: { subscription?: string | { id?: string } | null };
  } | null;
};

function asInvoice(value: unknown): InvoiceLike | null {
  if (!value || typeof value !== "object") return null;
  return value as InvoiceLike;
}

function clientSecretFromInvoice(invoice: InvoiceLike | null): string | null {
  if (!invoice) return null;
  const secret = invoice.confirmation_secret?.client_secret;
  if (typeof secret === "string" && secret) return secret;
  const pi = invoice.payment_intent;
  if (pi && typeof pi === "object" && typeof pi.client_secret === "string") {
    return pi.client_secret;
  }
  return null;
}

function paymentIntentIdFromInvoice(invoice: InvoiceLike | null): string | null {
  if (!invoice) return null;
  const pi = invoice.payment_intent;
  if (typeof pi === "string" && pi) return pi;
  if (pi && typeof pi === "object" && typeof pi.id === "string") return pi.id;
  return null;
}

function subscriptionIdFromInvoice(invoice: InvoiceLike | null): string | null {
  if (!invoice) return null;
  const direct = invoice.subscription;
  if (typeof direct === "string" && direct) return direct;
  if (direct && typeof direct === "object" && typeof direct.id === "string") {
    return direct.id;
  }
  const nested = invoice.parent?.subscription_details?.subscription;
  if (typeof nested === "string" && nested) return nested;
  if (nested && typeof nested === "object" && typeof nested.id === "string") {
    return nested.id;
  }
  return null;
}

function paymentIntentIdFromClientSecret(secret: string): string | null {
  const match = secret.match(/^(pi_[A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

async function monthlyGiftProductId(stripe: Stripe): Promise<string> {
  if (monthlyProductId) return monthlyProductId;
  const listed = await stripe.products.list({ active: true, limit: 100 });
  const existing = listed.data.find(
    (product) => product.metadata?.calclaim === "monthly_gift",
  );
  if (existing) {
    monthlyProductId = existing.id;
    return existing.id;
  }
  const created = await stripe.products.create({
    name: "CalClaim monthly gift",
    metadata: { calclaim: "monthly_gift" },
  });
  monthlyProductId = created.id;
  return created.id;
}

async function clientSecretForSubscription(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<{ clientSecret: string; paymentIntentId: string | null }> {
  const invoiceRef = subscription.latest_invoice;
  const invoiceId =
    typeof invoiceRef === "string"
      ? invoiceRef
      : invoiceRef && "id" in invoiceRef
        ? invoiceRef.id
        : null;
  let invoice = asInvoice(invoiceRef);
  let secret = clientSecretFromInvoice(invoice);
  if (!secret && invoiceId) {
    const expanded = await stripe.invoices.retrieve(invoiceId);
    invoice = asInvoice(expanded);
    secret = clientSecretFromInvoice(invoice);
  }
  if (!secret) throw new Error("subscription_missing_client_secret");
  return {
    clientSecret: secret,
    paymentIntentId:
      paymentIntentIdFromInvoice(invoice) ||
      paymentIntentIdFromClientSecret(secret),
  };
}

export async function createDonateCheckout(
  config: AppConfig,
  amountCents: number,
  monthly: boolean,
): Promise<{ clientSecret: string; paymentIntentId: string | null; subscriptionId: string | null }> {
  const stripe = getStripe(config);
  if (!stripe) throw new Error("stripe_unconfigured");

  const interval: DonationInterval = monthly ? "month" : "once";

  if (!monthly) {
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      description: "CalClaim gift",
      metadata: {
        source: "calclaim_donate",
        interval,
      },
    });
    if (!intent.client_secret) throw new Error("missing_client_secret");
    upsertDonation({
      paymentIntentId: intent.id,
      amountCents,
      interval: "once",
      status: intent.status,
    });
    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      subscriptionId: null,
    };
  }

  const customer = await stripe.customers.create({
    metadata: { source: "calclaim_donate" },
  });
  const productId = await monthlyGiftProductId(stripe);
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          recurring: { interval: "month" },
          product: productId,
        },
      },
    ],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    metadata: {
      source: "calclaim_donate",
      interval: "month",
    },
    expand: ["latest_invoice.confirmation_secret"],
  });
  const { clientSecret, paymentIntentId } = await clientSecretForSubscription(
    stripe,
    subscription,
  );
  upsertDonation({
    paymentIntentId,
    subscriptionId: subscription.id,
    amountCents,
    interval: "month",
    status: subscription.status,
  });
  return {
    clientSecret,
    paymentIntentId,
    subscriptionId: subscription.id,
  };
}

export async function handleDonateWebhook(
  config: AppConfig,
  rawBody: Buffer,
  signature: string,
): Promise<void> {
  const stripe = getStripe(config);
  if (!stripe || !config.stripeWebhookSecret) {
    throw new Error("stripe_webhook_unconfigured");
  }
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    config.stripeWebhookSecret,
  );

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const interval: DonationInterval =
      intent.metadata?.interval === "month" ? "month" : "once";
    upsertDonation({
      paymentIntentId: intent.id,
      amountCents: intent.amount_received || intent.amount,
      currency: intent.currency,
      interval,
      status: "succeeded",
    });
    return;
  }

  if (event.type === "invoice.paid") {
    const invoice = asInvoice(event.data.object);
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    const paymentIntentId = paymentIntentIdFromInvoice(invoice);
    upsertDonation({
      paymentIntentId,
      subscriptionId,
      amountCents: invoice?.amount_paid || 0,
      currency: invoice?.currency,
      interval: subscriptionId ? "month" : "once",
      status: "succeeded",
    });
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    markSubscriptionStatus(sub.id, "canceled");
  }
}
