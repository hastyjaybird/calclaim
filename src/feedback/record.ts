import type { SessionState } from "../library/types.js";
import { appendQcResponse } from "../qc/responses.js";
import {
  insertFeedbackTodo,
  type FeedbackSource,
} from "./todos.js";

/** Persist alpha-user feedback: QC log + developer To Do List. */
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
  insertFeedbackTodo({
    session: input.session,
    source: input.source,
    text: input.text,
    transcriptStatus: input.transcriptStatus,
  });
}
