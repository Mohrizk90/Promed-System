import { loadConfig } from "../config.js";
import { logger } from "../logger.js";

export type TtsResult = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
};

/**
 * Synthesize a short spoken reply via **Gemini TTS** using `GEMINI_API_KEY`
 * (same key as chat). Model: `GEMINI_TTS_MODEL` (default gemini-2.5-flash-preview-tts).
 */
export async function synthesizeSpeech(text: string): Promise<TtsResult | null> {
  const spoken = prepareSpokenText(text);
  if (!spoken) return null;

  const cfg = loadConfig();
  const model = cfg.GEMINI_TTS_MODEL;
  const voiceName = cfg.GEMINI_TTS_VOICE;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.GEMINI_API_KEY)}`;

  const body = {
    contents: [{ parts: [{ text: spoken }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  logger.info({ model, voiceName, chars: spoken.length }, "gemini tts request");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    logger.warn({ err }, "gemini tts fetch failed");
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.warn({ status: res.status, errText: errText.slice(0, 400), model }, "gemini tts http error");
    return null;
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const b64 = part?.inlineData?.data;
  if (!b64) {
    logger.warn({ model }, "gemini tts returned no audio part");
    return null;
  }

  const raw = Buffer.from(b64, "base64");
  const mime = part?.inlineData?.mimeType ?? "audio/L16;rate=24000";
  logger.info({ model, mime, bytes: raw.length }, "gemini tts ok");

  // Gemini TTS usually returns raw PCM (L16). Wrap as WAV for Telegram sendAudio.
  if (/L16|pcm|raw/i.test(mime) || !/ogg|mpeg|mp3|wav|webm/i.test(mime)) {
    const rateMatch = mime.match(/rate=(\d+)/i);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24_000;
    const wav = pcm16MonoToWav(raw, sampleRate);
    return { bytes: wav, mimeType: "audio/wav", filename: "reply.wav" };
  }

  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp3") || mime.includes("mpeg") ? "mp3" : "wav";
  return { bytes: raw, mimeType: mime, filename: `reply.${ext}` };
}

/** Keep spoken replies short and natural for an Arabic assistant. */
export function prepareSpokenText(text: string): string {
  let t = text
    .replace(/CONFIRM_SUMMARY:.*$/gim, "")
    .replace(/VOICE_REPLY:.*$/gim, "")
    .replace(/[`*_#>\-]+/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!t) return "";

  // Prefer the first ~2 sentences / ~280 chars for a short voice note.
  const sentences = t.split(/(?<=[.!?؟。])\s+/);
  t = sentences.slice(0, 2).join(" ");
  if (t.length > 280) t = `${t.slice(0, 277).trim()}…`;
  return t;
}

function pcm16MonoToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}
