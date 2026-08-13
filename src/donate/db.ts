import type Database from "better-sqlite3";

export type DonationInterval = "once" | "month";

export interface DonationRow {
  id: number;
  payment_intent_id: string | null;
  subscription_id: string | null;
  amount_cents: number;
  currency: string;
  interval: DonationInterval;
  status: string;
  created_at: string;
}

let db: Database.Database | null = null;

export function initDonations(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_intent_id TEXT UNIQUE,
      subscription_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      interval TEXT NOT NULL DEFAULT 'once',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_donations_subscription ON donations(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_donations_created ON donations(created_at);
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error("Donations DB not initialized");
  return db;
}

export function upsertDonation(input: {
  paymentIntentId?: string | null;
  subscriptionId?: string | null;
  amountCents: number;
  currency?: string;
  interval: DonationInterval;
  status: string;
}): void {
  const paymentIntentId = input.paymentIntentId?.trim() || null;
  const subscriptionId = input.subscriptionId?.trim() || null;
  const currency = (input.currency || "usd").toLowerCase();
  const now = new Date().toISOString();

  if (paymentIntentId) {
    getDb()
      .prepare(
        `INSERT INTO donations (
           payment_intent_id, subscription_id, amount_cents, currency, interval, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(payment_intent_id) DO UPDATE SET
           subscription_id = COALESCE(excluded.subscription_id, donations.subscription_id),
           amount_cents = excluded.amount_cents,
           currency = excluded.currency,
           interval = excluded.interval,
           status = excluded.status`,
      )
      .run(
        paymentIntentId,
        subscriptionId,
        input.amountCents,
        currency,
        input.interval,
        input.status,
        now,
      );
    return;
  }

  if (!subscriptionId) return;
  getDb()
    .prepare(
      `INSERT INTO donations (
         payment_intent_id, subscription_id, amount_cents, currency, interval, status, created_at
       ) VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      subscriptionId,
      input.amountCents,
      currency,
      input.interval,
      input.status,
      now,
    );
}

export function markSubscriptionStatus(
  subscriptionId: string,
  status: string,
): void {
  getDb()
    .prepare(
      `UPDATE donations SET status = ? WHERE subscription_id = ? AND interval = 'month'`,
    )
    .run(status, subscriptionId);
}
