import type { SessionState } from "../library/types.js";
import { appendQcResponse } from "../qc/responses.js";
import {
  recordSessionFeedbackTodos,
  type FeedbackSource,
} from "./todos.js";

/** Persist alpha-user feedback: QC log + developer To Do List (partner-attributed when QR). */
export function recordAlphaFeedback(input: {
  session: SessionState;
  text: string;
  source: FeedbackSource;
  transcriptStatus?: string | null;
}): void {
  const label =
    input.source === "voice"
      ? `[voice${input.transcriptStatus ? `:${input.transcriptStatus}` : ""}] ${input.text}`
      : input.text;
  appendQcResponse(input.session, label);
  // Partner-attributed paths may call an LLM to split points; do not block the bot reply.
  void recordSessionFeedbackTodos({
    session: input.session,
    source: input.source,
    text: input.text,
    transcriptStatus: input.transcriptStatus,
  }).catch((err) => {
    console.error("[feedback] failed to persist developer todos", err);
  });
}
