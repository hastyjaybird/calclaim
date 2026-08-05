import type Database from "better-sqlite3";
import type { SessionState } from "../library/types.js";

export type FeedbackSource = "text" | "voice" | "contact";
export type FeedbackTodoStatus = "open" | "done";

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
}

export interface ContactFeedbackFields {
  email: string;
  comments: string;
}

let db: Database.Database | null = null;

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
}

function getDb(): Database.Database {
  if (!db) throw new Error("Feedback todos DB not initialized");
  return db;
}

function insertTodoRow(input: {
  telegramUserId: number;
  step: string;
  source: FeedbackSource;
  text: string;
  transcriptStatus?: string | null;
  sessionSnapshot: string;
}): DeveloperFeedbackTodo {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO developer_feedback_todos
        (created_at, telegram_user_id, step, source, text, transcript_status, status, session_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      createdAt,
      input.telegramUserId,
      input.step,
      input.source,
      input.text,
      input.transcriptStatus ?? null,
      input.sessionSnapshot,
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
  };
}

export function insertFeedbackTodo(input: {
  session: SessionState;
  source: FeedbackSource;
  text: string;
  transcriptStatus?: string | null;
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
  });
  return insertTodoRow({
    telegramUserId: input.session.telegramUserId,
    step: input.session.step,
    source: input.source,
    text: input.text,
    transcriptStatus: input.transcriptStatus,
    sessionSnapshot: snapshot,
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

function rowToTodo(row: Record<string, unknown>): DeveloperFeedbackTodo {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    telegramUserId: Number(row.telegram_user_id),
    step: String(row.step),
    source: row.source as FeedbackSource,
    text: String(row.text),
    transcriptStatus: row.transcript_status == null ? null : String(row.transcript_status),
    status: row.status as FeedbackTodoStatus,
    sessionSnapshot: String(row.session_snapshot),
  };
}
