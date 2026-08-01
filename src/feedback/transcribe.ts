/**
 * Voice → text via OpenAI Whisper (or OpenAI-compatible /audio/transcriptions).
 * OpenRouter chat keys usually cannot hit this endpoint — set OPENAI_API_KEY.
 */

export interface TranscribeResult {
  text: string;
  status: "ok" | "unavailable" | "failed";
}

function resolveWhisperConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  const openAi = process.env.OPENAI_API_KEY?.trim();
  if (openAi) {
    return {
      apiKey: openAi,
      baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
        /\/$/,
        "",
      ),
      model: process.env.WHISPER_MODEL ?? "whisper-1",
    };
  }
  return null;
}

export function whisperAvailable(): boolean {
  return resolveWhisperConfig() != null;
}

export async function transcribeVoiceBuffer(
  buffer: Buffer,
  filename = "voice.ogg",
): Promise<TranscribeResult> {
  const cfg = resolveWhisperConfig();
  if (!cfg) {
    return {
      text: "[voice message — transcription unavailable; set OPENAI_API_KEY]",
      status: "unavailable",
    };
  }

  try {
    const form = new FormData();
    form.append("model", cfg.model);
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: "audio/ogg" }),
      filename,
    );

    const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Whisper transcription failed:", res.status, errText.slice(0, 300));
      return {
        text: "[voice message — transcription failed]",
        status: "failed",
      };
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    if (!text) {
      return { text: "[voice message — empty transcript]", status: "failed" };
    }
    return { text, status: "ok" };
  } catch (err) {
    console.error("Whisper transcription error:", err);
    return {
      text: "[voice message — transcription failed]",
      status: "failed",
    };
  }
}

export async function downloadTelegramFile(
  botToken: string,
  filePath: string,
): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Telegram file download failed: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
