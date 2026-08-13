import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionState } from "../library/types.js";
import { getPartnerByCampaignId } from "../analytics/partners.js";
import { splitFeedbackPoints } from "./split.js";

export type FeedbackSource = "text" | "voice" | "contact" | "tree" | "partner";
export type FeedbackTodoStatus = "open" | "done" | "disqualified";

export interface DeveloperFeedbackTodo {
  id: number;
  createdAt: string;
  telegramUserId: number;
  step: string;
  source: FeedbackSource;
  text: string;
  transcriptStatus: string | null;
  status: FeedbackTodoStatus;
  sessionSnapshot: string;
  campaignId: string | null;
  partnerSlug: string | null;
  groupId: string | null;
  pointIndex: number;
}

export interface ContactFeedbackFields {
  email: string;
  comments: string;
}

export interface TreeFeedbackFields {
  text: string;
  actions: string[];
  step: string;
  screenTitle: string;
  whyThisScreen?: string;
}

export interface PartnerFeedbackIngestResult {
  groupId: string;
  tickets: DeveloperFeedbackTodo[];
  feedbackMessages: number;
  feedbackTickets: number;
}

let db: Database.Database | null = null;

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (cols.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function initFeedbackTodos(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS developer_feedback_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      step TEXT NOT NULL,
      source TEXT NOT NULL,
      text TEXT NOT NULL,
      transcript_status TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      session_snapshot TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_todos_status
      ON developer_feedback_todos(status, created_at DESC);
  `);
  ensureColumn(db, "developer_feedback_todos", "campaign_id", "TEXT");
  ensureColumn(db, "developer_feedback_todos", "partner_slug", "TEXT");
  ensureColumn(db, "developer_feedback_todos", "group_id", "TEXT");
  ensureColumn(db, "developer_feedback_todos", "point_index", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_feedback_todos_campaign
      ON developer_feedback_todos(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_feedback_todos_group
      ON developer_feedback_todos(group_id);
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error("Feedback todos DB not initialized");
  return db;
}

function newGroupId(): string {
  return `fg_${randomBytes(8).toString("hex")}`;
}

function insertTodoRow(input: {
  telegramUserId: number;
  step: string;
  source: FeedbackSource;
  text: string;
  transcriptStatus?: string | null;
  sessionSnapshot: string;
  campaignId?: string | null;
  partnerSlug?: string | null;
  groupId?: string | null;
  pointIndex?: number;
}): DeveloperFeedbackTodo {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO developer_feedback_todos
        (created_at, telegram_user_id, step, source, text, transcript_status, status,
         session_snapshot, campaign_id, partner_slug, group_id, point_index)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    )
    .run(
      createdAt,
      input.telegramUserId,
      input.step,
      input.source,
      input.text,
      input.transcriptStatus ?? null,
      input.sessionSnapshot,
      input.campaignId ?? null,
      input.partnerSlug ?? null,
      input.groupId ?? null,
      input.pointIndex ?? 0,
    );
  return {
    id: Number(result.lastInsertRowid),
    createdAt,
    telegramUserId: input.telegramUserId,
    step: input.step,
    source: input.source,
    text: input.text,
    transcriptStatus: input.transcriptStatus ?? null,
    status: "open",
    sessionSnapshot: input.sessionSnapshot,
    campaignId: input.campaignId ?? null,
    partnerSlug: input.partnerSlug ?? null,
    groupId: input.groupId ?? null,
    pointIndex: input.pointIndex ?? 0,
  };
}

export function insertFeedbackTodo(input: {
  session: SessionState;
  source: FeedbackSource;
  text: string;
  transcriptStatus?: string | null;
  campaignId?: string | null;
  partnerSlug?: string | null;
  groupId?: string | null;
  pointIndex?: number;
}): DeveloperFeedbackTodo {
  const snapshot = JSON.stringify({
    branch: input.session.branch,
    householdSize: input.session.householdSize,
    incomeBand: input.session.incomeBand,
    queueIndex: input.session.queueIndex,
    queue: input.session.queue,
    alreadyOn: input.session.alreadyOn,
    language: input.session.language,
    step: input.session.step,
    campaignId: input.session.campaignId,
  });
  return insertTodoRow({
    telegramUserId: input.session.telegramUserId,
    step: input.session.step,
    source: input.source,
    text: input.text,
    transcriptStatus: input.transcriptStatus,
    sessionSnapshot: snapshot,
    campaignId: input.campaignId ?? input.session.campaignId,
    partnerSlug: input.partnerSlug,
    groupId: input.groupId,
    pointIndex: input.pointIndex,
  });
}

/** Web contact form → same developer feedback queue as Telegram alpha feedback. */
export function insertContactFeedbackTodo(
  fields: ContactFeedbackFields,
): DeveloperFeedbackTodo {
  const lines: string[] = [];
  if (fields.email) lines.push(`Email: ${fields.email}`);
  if (fields.comments) lines.push(fields.comments);
  return insertTodoRow({
    telegramUserId: 0,
    step: "contact_form",
    source: "contact",
    text: lines.join("\n"),
    sessionSnapshot: JSON.stringify({
      channel: "web_contact",
      email: fields.email,
      comments: fields.comments,
    }),
  });
}

/** Message-tree review page → developer request anchored to a tree location. */
export function insertTreeFeedbackTodo(
  fields: TreeFeedbackFields,
): DeveloperFeedbackTodo {
  const actions = fields.actions.map((a) => String(a)).filter(Boolean);
  const hash = actions.length
    ? `#a=${actions.map((a) => encodeURIComponent(a)).join(",")}`
    : "";
  const treePath = `/dev/tree${hash}`;
  const step = fields.step.trim() || "tree_review";
  return insertTodoRow({
    telegramUserId: 0,
    step,
    source: "tree",
    text: fields.text.trim(),
    sessionSnapshot: JSON.stringify({
      channel: "message_tree",
      actions,
      step,
      screenTitle: fields.screenTitle,
      whyThisScreen: fields.whyThisScreen || null,
      treePath,
    }),
  });
}

/**
 * Split feedback into tickets and attribute them to a partner campaign (QR / landing page).
 * Each distinct point becomes one open ticket; org metrics credit non-disqualified tickets.
 */
export async function ingestPartnerAttributedFeedback(input: {
  text: string;
  source: FeedbackSource;
  campaignId: string;
  partnerSlug: string;
  telegramUserId?: number;
  step?: string;
  transcriptStatus?: string | null;
  session?: SessionState | null;
  sessionSnapshotExtra?: Record<string, unknown>;
}): Promise<PartnerFeedbackIngestResult> {
  const points = await splitFeedbackPoints(input.text);
  if (!points.length) {
    return {
      groupId: "",
      tickets: [],
      ...countPartnerFeedbackMetrics(input.campaignId),
    };
  }

  const groupId = newGroupId();
  const baseSnapshot = input.session
    ? {
        branch: input.session.branch,
        householdSize: input.session.householdSize,
        incomeBand: input.session.incomeBand,
        queueIndex: input.session.queueIndex,
        queue: input.session.queue,
        alreadyOn: input.session.alreadyOn,
        language: input.session.language,
        step: input.session.step,
        campaignId: input.session.campaignId,
      }
    : {};
  const snapshot = JSON.stringify({
    ...baseSnapshot,
    ...input.sessionSnapshotExtra,
    channel:
      input.source === "partner" ? "partner_landing" : "partner_attributed",
    partnerSlug: input.partnerSlug,
    campaignId: input.campaignId,
    groupId,
    originalText: input.text.trim().slice(0, 4000),
    pointCount: points.length,
  });

  const tickets = points.map((point, index) =>
    insertTodoRow({
      telegramUserId: input.telegramUserId ?? input.session?.telegramUserId ?? 0,
      step: input.step ?? input.session?.step ?? "partner_feedback",
      source: input.source,
      text: point,
      transcriptStatus: input.transcriptStatus,
      sessionSnapshot: snapshot,
      campaignId: input.campaignId,
      partnerSlug: input.partnerSlug,
      groupId,
      pointIndex: index,
    }),
  );

  return {
    groupId,
    tickets,
    ...countPartnerFeedbackMetrics(input.campaignId),
  };
}

/** Partner landing-page feedback box. */
export async function ingestPartnerLandingFeedback(input: {
  partnerSlug: string;
  campaignId: string;
  text: string;
}): Promise<PartnerFeedbackIngestResult> {
  return ingestPartnerAttributedFeedback({
    text: input.text,
    source: "partner",
    campaignId: input.campaignId,
    partnerSlug: input.partnerSlug,
    telegramUserId: 0,
    step: "partner_landing",
    sessionSnapshotExtra: {
      channel: "partner_landing",
    },
  });
}

/**
 * If the session started via a partner QR/campaign, split + credit that org.
 * Otherwise insert a single unattributed todo (legacy behavior).
 */
export async function recordSessionFeedbackTodos(input: {
  session: SessionState;
  source: FeedbackSource;
  text: string;
  transcriptStatus?: string | null;
}): Promise<DeveloperFeedbackTodo[]> {
  const campaignId = input.session.campaignId?.trim() || null;
  const partner = campaignId ? getPartnerByCampaignId(campaignId) : undefined;
  if (partner) {
    const result = await ingestPartnerAttributedFeedback({
      text: input.text,
      source: input.source,
      campaignId: partner.campaignId,
      partnerSlug: partner.slug,
      session: input.session,
      transcriptStatus: input.transcriptStatus,
    });
    return result.tickets;
  }
  return [
    insertFeedbackTodo({
      session: input.session,
      source: input.source,
      text: input.text,
      transcriptStatus: input.transcriptStatus,
    }),
  ];
}

export function listFeedbackTodos(opts?: {
  status?: FeedbackTodoStatus | "all";
  limit?: number;
}): DeveloperFeedbackTodo[] {
  const limit = opts?.limit ?? 100;
  const status = opts?.status ?? "open";
  const rows =
    status === "all"
      ? (getDb()
          .prepare(
            `SELECT * FROM developer_feedback_todos
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(limit) as Record<string, unknown>[])
      : (getDb()
          .prepare(
            `SELECT * FROM developer_feedback_todos
             WHERE status = ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(status, limit) as Record<string, unknown>[]);
  return rows.map(rowToTodo);
}

export function setFeedbackTodoStatus(
  id: number,
  status: FeedbackTodoStatus,
): DeveloperFeedbackTodo | null {
  getDb()
    .prepare(`UPDATE developer_feedback_todos SET status = ? WHERE id = ?`)
    .run(status, id);
  const row = getDb()
    .prepare(`SELECT * FROM developer_feedback_todos WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToTodo(row) : null;
}

export function eraseUserFeedbackTodos(telegramUserId: number): void {
  getDb()
    .prepare(`DELETE FROM developer_feedback_todos WHERE telegram_user_id = ?`)
    .run(telegramUserId);
}

export function countOpenFeedbackTodos(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM developer_feedback_todos WHERE status = 'open'`,
    )
    .get() as { n: number };
  return row.n;
}

/** Live org metrics: messages with ≥1 credited ticket, and credited ticket count. */
export function countPartnerFeedbackMetrics(
  campaignId: string | string[],
): {
  feedbackMessages: number;
  feedbackTickets: number;
} {
  const ids = (Array.isArray(campaignId) ? campaignId : [campaignId]).filter(
    Boolean,
  );
  if (!ids.length) {
    return { feedbackMessages: 0, feedbackTickets: 0 };
  }
  const placeholders = ids.map(() => "?").join(", ");
  const tickets = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM developer_feedback_todos
       WHERE campaign_id IN (${placeholders}) AND status != 'disqualified'`,
    )
    .get(...ids) as { n: number };
  const messages = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT group_id) AS n FROM developer_feedback_todos
       WHERE campaign_id IN (${placeholders})
         AND status != 'disqualified'
         AND group_id IS NOT NULL
         AND group_id != ''`,
    )
    .get(...ids) as { n: number };
  return {
    feedbackMessages: Number(messages.n) || 0,
    feedbackTickets: Number(tickets.n) || 0,
  };
}

function rowToTodo(row: Record<string, unknown>): DeveloperFeedbackTodo {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    telegramUserId: Number(row.telegram_user_id),
    step: String(row.step),
    source: row.source as FeedbackSource,
    text: String(row.text),
    transcriptStatus:
      row.transcript_status == null ? null : String(row.transcript_status),
    status: row.status as FeedbackTodoStatus,
    sessionSnapshot: String(row.session_snapshot),
    campaignId: row.campaign_id == null ? null : String(row.campaign_id),
    partnerSlug: row.partner_slug == null ? null : String(row.partner_slug),
    groupId: row.group_id == null ? null : String(row.group_id),
    pointIndex: Number(row.point_index ?? 0),
  };
}
