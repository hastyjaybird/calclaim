import { insertContactFeedbackTodo } from "../feedback/todos.js";
import type { DeveloperFeedbackTodo } from "../feedback/todos.js";

export interface ContactMessage {
  phone: string;
  email: string;
  comments: string;
}

function trimField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/** Persist contact-form feedback into the developer SQLite feedback queue. */
export function appendContactMessage(input: {
  phone?: unknown;
  email?: unknown;
  comments?: unknown;
}): DeveloperFeedbackTodo | null {
  const phone = trimField(input.phone, 80);
  const email = trimField(input.email, 200);
  const comments = trimField(input.comments, 4000);
  if (!phone && !email && !comments) return null;
  return insertContactFeedbackTodo({ phone, email, comments });
}
