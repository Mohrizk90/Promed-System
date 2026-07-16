import type TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger.js";

/** Download a file from Telegram and return its bytes + mimeType. */
export async function downloadTelegramFile(
  bot: TelegramBot,
  fileId: string,
): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
  const link = await bot.getFile(fileId);
  if (!link.file_path) {
    throw new Error(`getFile returned no file_path for ${fileId}`);
  }
  // node-telegram-bot-api stores the token on the bot instance at runtime even though
  // the public type does not declare it; we cast through unknown to access it.
  const token = (bot as unknown as { token?: string }).token;
  if (!token) {
    throw new Error("bot token not available for file download");
  }
  const url = `https://api.telegram.org/file/bot${token}/${link.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const arr = new Uint8Array(await res.arrayBuffer());
  const mimeType = guessMimeType(link.file_path);
  const fileName = link.file_path.split("/").pop() ?? "file";
  return { bytes: Buffer.from(arr), mimeType, fileName };
}

export function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

/**
 * Send a PDF (or any file) to a chat. If `signedUrl` is a http(s) URL the bot
 * fetches it then uploads via sendDocument. On any failure we fall back to
 * sending the URL as a clickable link so the user always sees something.
 */
export async function sendPdfToChat(
  bot: TelegramBot,
  chatId: number,
  signedUrl: string,
  filename: string,
): Promise<void> {
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`fetch signed url: ${res.status}`);
    const arr = new Uint8Array(await res.arrayBuffer());
    await bot.sendDocument(chatId, Buffer.from(arr), {}, { filename, contentType: "application/pdf" });
    return;
  } catch (err) {
    logger.warn({ err }, "sendPdfToChat: direct upload failed; falling back to link");
    await bot.sendMessage(chatId, `📄 ${filename}\n${signedUrl}`);
  }
}
