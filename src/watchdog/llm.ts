import type { Program } from "../library/types.js";
import type { DraftFinding, FindingCategory, FindingSeverity } from "./types.js";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function resolveLlmConfig(): LlmConfig | null {
  const openRouter = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouter) {
    return {
      apiKey: openRouter,
      baseUrl: (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(
        /\/$/,
        "",
      ),
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
    };
  }
  const openAi = process.env.OPENAI_API_KEY?.trim();
  if (openAi) {
    return {
      apiKey: openAi,
      baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    };
  }
  return null;
}

export function llmAvailable(): boolean {
  return resolveLlmConfig() != null;
}

interface LlmFindingJson {
  category?: string;
  severity?: string;
  title?: string;
  detail?: string;
  suggestedAction?: string;
  libraryField?: string;
  evidenceQuote?: string;
}

const CATEGORIES = new Set<FindingCategory>([
  "deadline",
  "eligibility",
  "apply_process",
  "funding_status",
  "max_benefit",
  "apply_url",
  "link_health",
  "docs_needed",
  "income_bands",
  "program_status",
  "branding",
  "est_annual",
  "other",
]);

const SEVERITIES = new Set<FindingSeverity>([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export async function analyzeProgramWithLlm(
  program: Program,
  pageTexts: Array<{ url: string; text: string }>,
): Promise<DraftFinding[]> {
  const cfg = resolveLlmConfig();
  if (!cfg || !pageTexts.length) return [];

  const librarySnapshot = {
    id: program.id,
    name: program.name,
    oneLiner: program.oneLiner,
    maxBenefit: program.maxBenefit,
    maxBenefitUsd: program.maxBenefitUsd,
    estAnnualUsd: program.estAnnualUsd,
    applyUrl: program.applyUrl,
    deadlines: program.deadlines,
    applySteps: program.applySteps,
    docsNeeded: program.docsNeeded,
    incomeGate: program.incomeGate ?? null,
    requiresPastDue: program.requiresPastDue ?? false,
    requiresChildInHousehold: program.requiresChildInHousehold ?? false,
  };

  const pages = pageTexts.map((p) => ({
    url: p.url,
    text: p.text.slice(0, 10_000),
  }));

  const system = `You are a careful benefits-program library auditor for CalClaim, a California financial-aid navigator chatbot.
Compare the frozen library JSON against live official page text.
ONLY report concrete, evidence-backed mismatches or risks that would require a human developer to edit the library.
Do NOT invent eligibility rules. If unsure, omit the finding or mark severity "info".
Never suggest auto-applying changes – findings are advisory only.
Return JSON only: {"findings":[{category,severity,title,detail,suggestedAction,libraryField,evidenceQuote}]}
Categories: deadline, eligibility, apply_process, funding_status, max_benefit, apply_url, docs_needed, program_status, branding, est_annual, other
Severities: critical, high, medium, low, info
Max 6 findings. Empty findings array is fine.`;

  const user = JSON.stringify({ library: librarySnapshot, livePages: pages });

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "HTTP-Referer": process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
        "X-Title": "CalClaim Library Watcher",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return [
        {
          programId: program.id,
          category: "other",
          severity: "info",
          title: `LLM analysis skipped for ${program.name}`,
          detail: `API ${res.status}: ${body.slice(0, 200)}`,
          source: "llm",
        },
      ];
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { findings?: LlmFindingJson[] };
    const raw = Array.isArray(parsed.findings) ? parsed.findings : [];

    return raw
      .slice(0, 6)
      .map((f): DraftFinding | null => {
        const category = (CATEGORIES.has(f.category as FindingCategory)
          ? f.category
          : "other") as FindingCategory;
        const severity = (SEVERITIES.has(f.severity as FindingSeverity)
          ? f.severity
          : "medium") as FindingSeverity;
        if (!f.title || !f.detail) return null;
        const quote = f.evidenceQuote ? ` Evidence: “${f.evidenceQuote}”.` : "";
        return {
          programId: program.id,
          category,
          severity,
          title: String(f.title).slice(0, 200),
          detail: `${String(f.detail).slice(0, 1200)}${quote}`,
          evidenceUrl: pages[0]?.url ?? program.applyUrl,
          suggestedAction: f.suggestedAction
            ? String(f.suggestedAction).slice(0, 500)
            : "Review official page and update library/programs.json if needed.",
          libraryField: f.libraryField ? String(f.libraryField).slice(0, 120) : null,
          source: "llm",
        };
      })
      .filter((x): x is DraftFinding => x != null);
  } catch (err) {
    return [
      {
        programId: program.id,
        category: "other",
        severity: "info",
        title: `LLM analysis error for ${program.name}`,
        detail: err instanceof Error ? err.message : String(err),
        source: "llm",
      },
    ];
  }
}
