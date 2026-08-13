/**
 * Split a feedback paragraph into distinct actionable points / tickets.
 * Prefers LLM when configured; falls back to list / sentence heuristics.
 */
import { resolveLlmConfig } from "../watchdog/llm.js";

const MAX_POINTS = 12;
const MAX_POINT_LEN = 1200;

function cleanPoint(text: string): string {
  return text
    .replace(/^[\s•\-*–—]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_POINT_LEN);
}

function dedupePoints(points: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of points) {
    const p = cleanPoint(raw);
    if (p.length < 3) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= MAX_POINTS) break;
  }
  return out;
}

/** Offline / no-LLM splitter: bullets, numbered lists, paragraphs, then sentences. */
export function splitFeedbackPointsHeuristic(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const listLike = lines.filter((l) => /^([•\-*–—]|\d+[.)])\s+\S/.test(l));
  if (listLike.length >= 2) {
    const extras = lines.filter((l) => !/^([•\-*–—]|\d+[.)])\s+\S/.test(l));
    return dedupePoints([...listLike, ...extras]);
  }

  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 3);
  if (paragraphs.length >= 2) {
    return dedupePoints(paragraphs);
  }

  // Long single block: split on sentence boundaries when clearly multi-point.
  if (trimmed.length > 180) {
    const sentences = trimmed
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ"'])/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12);
    if (sentences.length >= 2) {
      return dedupePoints(sentences);
    }
  }

  return dedupePoints([trimmed]);
}

async function splitFeedbackPointsWithLlm(text: string): Promise<string[] | null> {
  const cfg = resolveLlmConfig();
  if (!cfg) return null;

  const prompt = `You extract distinct product-feedback points for a developer ticket queue.

Rules:
- Return JSON only: {"points":["..."]}
- Each point is one actionable issue, suggestion, or observation.
- Split a paragraph that raises multiple issues into separate points.
- Do not invent issues that are not in the text.
- If the whole message is one point, return a single-item array with a concise paraphrase or the original wording.
- Ignore greetings, signatures, and empty fluff.
- Max ${MAX_POINTS} points.

User feedback:
"""
${text.slice(0, 4000)}
"""`;

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        ...(cfg.baseUrl.includes("openrouter")
          ? { "HTTP-Referer": "https://calclaim.jayhasty.com", "X-Title": "CalClaim" }
          : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You split user feedback into distinct developer ticket points. Reply with JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    const parsed = JSON.parse(content) as { points?: unknown };
    if (!Array.isArray(parsed.points)) return null;
    const points = dedupePoints(parsed.points.map((p) => String(p)));
    return points.length ? points : null;
  } catch {
    return null;
  }
}

/** Prefer LLM when available; always returns at least one point for non-empty text. */
export async function splitFeedbackPoints(text: string): Promise<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const fromLlm = await splitFeedbackPointsWithLlm(trimmed);
  if (fromLlm?.length) return fromLlm;
  return splitFeedbackPointsHeuristic(trimmed);
}
