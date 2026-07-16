import { createHash, randomBytes } from "node:crypto";
import type TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger.js";
import { RateLimiter } from "../ratelimit.js";
import {
  writeAudit,
  writeError,
  upsertPending,
  clearPending as auditClearPending,
  fiveMinBucket,
} from "../audit.js";
import { getMcpClient } from "../mcp/client.js";
import { getGemini, type GeminiInlinePart } from "../gemini/client.js";
import { buildToolList } from "../gemini/prompt.js";
import { getSession, clearPendingFor, persistSession, formatSessionContext, type Session } from "../session/store.js";
import {
  buildConfirmKeyboard,
  buildCancelKeyboard,
  parseCallbackData,
  isYesDelete,
} from "./keyboards.js";
import { createLinkCode, resolveLink, touchLastSeen, relativeTime } from "./linking.js";
import { downloadTelegramFile, sendPdfToChat } from "./files.js";
import { synthesizeSpeech } from "../gemini/tts.js";

const WELCOME =
  "Welcome to Promed ERP Assistant. /link to connect your account. /help for commands.\n\n" +
  "مرحباً بك في مساعد Promed. /link لربط حسابك. /help للأوامر.";

const HELP = [
  "/start — Welcome + bump last seen",
  "/link — Generate a 6-char claim code (15 min TTL)",
  "/whoami — Show the linked Supabase user",
  "/cancel — Clear any pending confirmation",
  "/help — This message",
  "",
  "Send any text, voice note, or photo to chat with the assistant.",
].join("\n");

const WRITE_PREFIXES = ["create_", "update_", "delete_", "add_", "remove_", "set_"];

function isWriteTool(name: string): boolean {
  const lower = name.toLowerCase();
  return WRITE_PREFIXES.some((p) => lower.startsWith(p));
}

function hashArgs(args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 16);
}

function nonce(): string {
  return randomBytes(8).toString("hex");
}

function sendText(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  // Default to plain text so arbitrary Gemini output (which can contain
  // Markdown punctuation like _, *, [, ], `, ~) doesn't trigger Telegram's
  // "can't parse entities" Bad Request mid-conversation.
  return bot.sendMessage(chatId, text).then(() => undefined);
}

function notLinkedReply(): string {
  return "Your account isn't linked yet. Send /link to get a 6-char code, then paste it in Promed → Settings → Telegram.";
}

function detectLocaleHint(text: string): "en" | "ar" | "auto" {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  return "auto";
}

export type HandlerDeps = {
  bot: TelegramBot | null;
  rateLimiter: RateLimiter;
  dryRun: boolean;
};

export function registerHandlers(deps: HandlerDeps): void {
  const { bot, rateLimiter, dryRun } = deps;

  if (!bot) {
    logger.warn("registerHandlers: no bot instance (dryRun=true); handlers will not fire");
    return;
  }

  bot.onText(/^\/start(?:@\w+)?\s*$/, async (msg) => {
    const chatId = msg.chat.id;
    const link = await resolveLink(chatId).catch(() => null);
    if (link) await touchLastSeen(chatId).catch(() => undefined);
    await safeSend(bot, dryRun, chatId, WELCOME);
  });

  bot.onText(/^\/help(?:@\w+)?\s*$/, async (msg) => {
    await safeSend(bot, dryRun, msg.chat.id, HELP);
  });

  bot.onText(/^\/link(?:@\w+)?\s*$/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const code = await createLinkCode(chatId);
      const text =
        `Open Promed web → Settings → Telegram, paste this code: \`${code.code}\`. ` +
        `Code expires in 15 minutes.\n\n` +
        `افتح Promed → الإعدادات → Telegram وألصق هذا الرمز: \`${code.code}\`. ` +
        `صالح لمدة 15 دقيقة.`;
      await safeSend(bot, dryRun, chatId, text);
    } catch (err) {
      writeError({ source: "supabase", severity: "error", message: (err as Error).message, ctx: { chatId } });
      await safeSend(bot, dryRun, chatId, "Couldn't generate a link code right now. Try again in a moment.");
    }
  });

  bot.onText(/^\/whoami(?:@\w+)?\s*$/, async (msg) => {
    const chatId = msg.chat.id;
    const link = await resolveLink(chatId).catch(() => null);
    if (!link) {
      await safeSend(bot, dryRun, chatId, notLinkedReply());
      return;
    }
    await safeSend(
      bot,
      dryRun,
      chatId,
      `Linked as ${link.email ?? "(no email)"} (Supabase user_id ${link.user_id}). Last seen ${relativeTime(link.last_seen_at)}.`,
    );
  });

  bot.onText(/^\/cancel(?:@\w+)?\s*$/, async (msg) => {
    const chatId = msg.chat.id;
    clearPendingFor(chatId);
    auditClearPending(chatId);
    await safeSend(bot, dryRun, chatId, "Cancelled.");
  });

  // Text messages.
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ?? "";
    if (text.startsWith("/")) return; // commands handled above
    if (msg.voice || msg.photo || msg.document || msg.audio) return; // handled below

    if (!rateLimiter.allow(chatId)) {
      await safeSend(bot, dryRun, chatId, "Slow down — try again in a minute.");
      return;
    }

    const session = await getSession(chatId);
    const link = await resolveLink(chatId).catch(() => null);
    if (!link) {
      await safeSend(bot, dryRun, chatId, notLinkedReply());
      return;
    }
    await touchLastSeen(chatId).catch(() => undefined);

    try {
      await bot.sendChatAction(chatId, "typing").catch(() => undefined);
      await safeSend(bot, dryRun, chatId, "حاضر، ثواني…");
      await handleUserTurn({
        bot,
        dryRun,
        chatId,
        userId: link.user_id,
        parts: [{ kind: "text", text }],
        session,
        latestText: text,
        preferVoice: true,
      });
    } catch (err) {
      writeError({ source: "telegram", severity: "error", message: (err as Error).message, ctx: { chatId } });
      await safeSend(
        bot,
        dryRun,
        chatId,
        "حصلت مشكلة مؤقتة. جرّب تاني أو صِغ الطلب بشكل أوضح.",
      );
    }
  });

  // Voice notes.
  bot.on("voice", async (msg) => {
    const chatId = msg.chat.id;
    if (!rateLimiter.allow(chatId)) {
      await safeSend(bot, dryRun, chatId, "Slow down — try again in a minute.");
      return;
    }
    const voice = msg.voice;
    if (!voice) return;
    const session = await getSession(chatId);
    const link = await resolveLink(chatId).catch(() => null);
    if (!link) {
      await safeSend(bot, dryRun, chatId, notLinkedReply());
      return;
    }
    await touchLastSeen(chatId).catch(() => undefined);

    try {
      await bot.sendChatAction(chatId, "record_voice").catch(() => undefined);
      await safeSend(bot, dryRun, chatId, "حاضر، بسمع الرسالة…");
      const file = await downloadTelegramFile(bot, voice.file_id);
      await handleUserTurn({
        bot,
        dryRun,
        chatId,
        userId: link.user_id,
        parts: [{ kind: "audio", mimeType: file.mimeType, base64: file.bytes.toString("base64") }],
        session,
        latestText: "(voice note)",
        preferVoice: true,
      });
    } catch (err) {
      writeError({ source: "telegram", severity: "error", message: (err as Error).message, ctx: { chatId } });
      await safeSend(bot, dryRun, chatId, "ما قدرتش أحمل الرسالة الصوتية. ابعت تاني أو اكتب النص.");
    }
  });

  // Photos.
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    if (!rateLimiter.allow(chatId)) {
      await safeSend(bot, dryRun, chatId, "Slow down — try again in a minute.");
      return;
    }
    const photos = msg.photo ?? [];
    const biggest = photos[photos.length - 1];
    if (!biggest) return;

    const session = await getSession(chatId);
    const link = await resolveLink(chatId).catch(() => null);
    if (!link) {
      await safeSend(bot, dryRun, chatId, notLinkedReply());
      return;
    }
    await touchLastSeen(chatId).catch(() => undefined);

    const caption = msg.caption ?? "(photo)";

    try {
      await bot.sendChatAction(chatId, "typing").catch(() => undefined);
      const file = await downloadTelegramFile(bot, biggest.file_id);
      await handleUserTurn({
        bot,
        dryRun,
        chatId,
        userId: link.user_id,
        parts: [
          { kind: "image", mimeType: file.mimeType, base64: file.bytes.toString("base64") },
          { kind: "text", text: caption },
        ],
        session,
        latestText: caption,
        preferVoice: true,
      });
    } catch (err) {
      writeError({ source: "telegram", severity: "error", message: (err as Error).message, ctx: { chatId } });
      await safeSend(bot, dryRun, chatId, "ما قدرتش أحمل الصورة. ابعت تاني.");
    }
  });

  // Inline keyboard callbacks.
  bot.on("callback_query", async (q) => {
    const data = q.data ?? "";
    const chatId = q.message?.chat.id;
    if (chatId === undefined) {
      await bot.answerCallbackQuery(q.id).catch(() => undefined);
      return;
    }
    const parsed = parseCallbackData(data);

    // Always clear the spinner first.
    await bot.answerCallbackQuery(q.id, { text: "" }).catch(() => undefined);

    if (parsed.kind === "cancel") {
      clearPendingFor(chatId);
      auditClearPending(chatId);
      await safeSend(bot, dryRun, chatId, "Cancelled.");
      return;
    }

    if (parsed.kind !== "confirm") {
      await safeSend(bot, dryRun, chatId, "Unknown button.");
      return;
    }

    const session = await getSession(chatId);
    const pending = session.pendingConfirmation;
    if (!pending || pending.nonce !== parsed.nonce || pending.argsHash !== parsed.argsHash) {
      await safeSend(bot, dryRun, chatId, "That confirmation expired or doesn't match.");
      return;
    }
    if (pending.expiresAt < Date.now()) {
      clearPendingFor(chatId);
      auditClearPending(chatId);
      await safeSend(bot, dryRun, chatId, "Confirmation expired. Please try again.");
      return;
    }

    // Deletes require a literal "yes, delete" follow-up text message.
    if (pending.tool.toLowerCase().startsWith("delete_")) {
      const lastTurn = session.turns[session.turns.length - 1];
      const latestRaw =
        lastTurn && lastTurn.role !== "function" && lastTurn.parts?.[0]?.text
          ? lastTurn.parts[0].text
          : "";
      const latest = latestRaw.trim().toLowerCase();
      if (!isYesDelete(latest)) {
        await safeSend(
          bot,
          dryRun,
          chatId,
          `Type \`yes, delete\` to confirm deletion of ${pending.summary}.`,
        );
        return;
      }
    }

    // Execute.
    const link = await resolveLink(chatId).catch(() => null);
    if (!link) {
      await safeSend(bot, dryRun, chatId, notLinkedReply());
      return;
    }

    const mcp = getMcpClient(link.user_id, null);
    const start = Date.now();
    let ok = true;
    let error: string | null = null;
    try {
      const result = await mcp.callTool(pending.tool, pending.args);
      ok = !result.isError;
      if (!ok) error = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
    } catch (err) {
      ok = false;
      error = (err as Error).message;
    }
    const duration = Date.now() - start;
    writeAudit({
      chatId,
      userId: link.user_id,
      toolName: pending.tool,
      toolKind: "write",
      argsHash: pending.argsHash,
      ok,
      error,
      durationMs: duration,
    });
    writeError({
      source: "mcp",
      severity: ok ? "info" : "error",
      message: ok ? `${pending.tool} ok` : `${pending.tool} failed: ${error}`,
      ctx: { chatId, tool: pending.tool },
    });

    clearPendingFor(chatId);
    auditClearPending(chatId);

    if (ok) {
      await safeSend(
        bot,
        dryRun,
        chatId,
        `Done — ${pending.tool} completed in ${duration} ms.`,
      );
    } else {
      await safeSend(bot, dryRun, chatId, `Failed — ${error ?? "unknown error"}.`);
    }
  });
}

async function safeSend(bot: TelegramBot, dryRun: boolean, chatId: number, text: string): Promise<void> {
  if (dryRun) {
    logger.info({ BOT_DRY_RUN: true, chatId, text }, "BOT_DRY_RUN: would send");
    return;
  }
  try {
    await sendText(bot, chatId, text);
  } catch (err) {
    writeError({ source: "telegram", severity: "error", message: (err as Error).message, ctx: { chatId } });
  }
}

type HandleArgs = {
  bot: TelegramBot;
  dryRun: boolean;
  chatId: number;
  userId: string;
  parts: GeminiInlinePart[];
  session: Session;
  latestText: string;
  /** When true (default for chat), always try a short voice reply. */
  preferVoice?: boolean;
};

async function handleUserTurn(args: HandleArgs): Promise<void> {
  const { bot, dryRun, chatId, userId, parts, session, latestText, preferVoice = true } = args;

  // Record the user turn. `session.turns` is text-only (audio/image bytes are
  // sent inline this round); we MUST keep at least one text part here or the
  // next conversation round will replay an empty Content and the Gemini SDK
  // throws "Each Content should have at least one part" at startChat.
  const textParts = parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => ({ text: p.text }));
  const storedTextParts =
    textParts.length > 0 ? textParts : [{ text: latestText || "(non-text input)" }];
  session.turns.push({ role: "user", parts: storedTextParts });

  // Pull MCP tools (cached for the process is fine; auth context is the same).
  let tools;
  try {
    tools = await getMcpClient(userId, null).listTools();
  } catch (err) {
    writeError({ source: "mcp", severity: "error", message: (err as Error).message, ctx: { chatId } });
    await safeSend(bot, dryRun, chatId, "MCP is unreachable right now. Try again shortly.");
    return;
  }

  const locale = detectLocaleHint(latestText);
  const sessionContext = formatSessionContext(session);

  let result: Awaited<ReturnType<ReturnType<typeof getGemini>["runLoop"]>>;
  try {
    result = await getGemini().runLoop({
    locale,
    tools,
    sessionContext,
    history: session.turns.slice(0, -1).map((t): import("../gemini/client.js").GeminiTurn => {
      if (t.role === "user") {
        return {
          role: "user",
          parts: t.parts.map((p) => ({ kind: "text" as const, text: p.text })),
        };
      }
      if (t.role === "model") {
        return { role: "model", text: t.parts.map((p) => p.text).join("\n") };
      }
      return { role: "function", name: t.name, response: t.response };
    }),
    userParts: parts,
    callMcpTool: async (name, callArgs) => {
      const h = hashArgs(callArgs);
      const kind: "read" | "write" = isWriteTool(name) ? "write" : "read";

      // Writes must be confirmed via the inline keyboard — never call MCP directly.
      if (kind === "write") {
        const summary = extractSummary(latestText) ?? `${name} on ${summariseArgs(callArgs)}`;
        const n = nonce();
        const expiresAt = Date.now() + 10 * 60_000;
        session.pendingConfirmation = {
          tool: name,
          args: callArgs,
          argsHash: h,
          summary,
          nonce: n,
          expiresAt,
        };
        upsertPending({
          chatId,
          userId,
          toolName: name,
          argsHash: h,
          args: callArgs,
          summary,
          expiresAt: new Date(expiresAt).toISOString(),
        });
        // Return a sentinel so the loop's callTool is "ok" but Gemini doesn't re-call.
        return { pending_confirmation: true, summary };
      }

      const start = Date.now();
      try {
        const r = await getMcpClient(userId, null).callTool(name, callArgs);
        const duration = Date.now() - start;
        writeAudit({
          chatId,
          userId,
          toolName: name,
          toolKind: kind,
          argsHash: h,
          ok: !r.isError,
          error: r.isError ? String(JSON.stringify(r.content)) : null,
          durationMs: duration,
        });
        writeError({
          source: "mcp",
          severity: r.isError ? "warn" : "info",
          message: r.isError ? `${name} returned error` : `${name} ok`,
          ctx: { chatId, tool: name, duration_ms: duration },
        });

        // Parse MCP text content into a plain object so Gemini gets a Struct,
        // and so we can detect signed PDF URLs and deliver them to Telegram.
        const parsed = parseMcpContent(r.content);
        if (
          !r.isError &&
          !dryRun &&
          bot &&
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as { signedUrl?: unknown }).signedUrl === "string"
        ) {
          const signedUrl = (parsed as { signedUrl: string }).signedUrl;
          const filename =
            name === "generate_invoice"
              ? `invoice-${String((callArgs as { transaction_id?: unknown }).transaction_id ?? "file")}.pdf`
              : `statement-${String((callArgs as { client_id?: unknown }).client_id ?? "file")}.pdf`;
          await sendPdfToChat(bot, chatId, signedUrl, filename).catch((err) => {
            logger.warn({ err }, "sendPdfToChat failed");
          });
        }

        return parsed;
      } catch (err) {
        const duration = Date.now() - start;
        writeAudit({
          chatId,
          userId,
          toolName: name,
          toolKind: kind,
          argsHash: h,
          ok: false,
          error: (err as Error).message,
          durationMs: duration,
        });
        writeError({
          source: "mcp",
          severity: "error",
          message: (err as Error).message,
          ctx: { chatId, tool: name, duration_ms: duration },
        });
        throw err;
      }
    },
  });
  } catch (err) {
    writeError({ source: "telegram", severity: "error", message: (err as Error).message, ctx: { chatId } });
    await safeSend(
      bot,
      dryRun,
      chatId,
      "ما قدرتش أكمل الطلب دلوقتي. جرّب تاني بعد شوية.\nI couldn't complete that request. Please try again shortly.",
    );
    return;
  }

  // Remember what the user asked + which tools ran, so follow-ups like
  // «نفس الطلب» / «اللي فات» work even after restarts / voice-only turns.
  if (result.toolCalls.length > 0) {
    session.lastToolSummary = result.toolCalls
      .map((tc) => `${tc.name}(${summariseArgs(tc.args)})${tc.ok ? "" : " ERR"}`)
      .join("; ");
    // Prefer explicit text; for voice notes derive intent from the tools just called.
    if (latestText && latestText !== "(voice note)" && latestText !== "(non-text input)" && latestText !== "(photo)") {
      session.lastUserIntent = latestText;
    } else {
      session.lastUserIntent = session.lastToolSummary;
    }
    // Patch the just-pushed user turn so history isn't stuck on "(voice note)".
    const lastUser = [...session.turns].reverse().find((t) => t.role === "user");
    if (
      lastUser &&
      lastUser.role === "user" &&
      lastUser.parts[0]?.text &&
      (/^\(voice note\)$|^\(non-text input\)$|^\(photo\)$/i.test(lastUser.parts[0].text))
    ) {
      lastUser.parts = [{ text: session.lastUserIntent || lastUser.parts[0].text }];
    }
  } else if (latestText && latestText !== "(voice note)" && latestText !== "(non-text input)") {
    session.lastUserIntent = latestText;
  }

  // After a write tool was requested we asked Gemini to emit a CONFIRM_SUMMARY,
  // not to actually run the tool. Present the keyboard.
  const lastPending = session.pendingConfirmation;
  if (lastPending && result.text.includes("CONFIRM_SUMMARY")) {
    const cleaned = result.text.replace(/\n?CONFIRM_SUMMARY:.*$/im, "").trim();
    if (cleaned) await safeSend(bot, dryRun, chatId, cleaned);
    await safeSend(
      bot,
      dryRun,
      chatId,
      `Confirm: ${lastPending.summary}`,
    );
    if (!dryRun) {
      await bot
        .sendMessage(chatId, "Tap to proceed:", {
          reply_markup: buildConfirmKeyboard(lastPending.tool, lastPending.argsHash, lastPending.nonce),
        })
        .catch(async () => {
          await bot.sendMessage(chatId, "(Buttons couldn't render; tap Confirm in your keyboard.)", {
            reply_markup: buildCancelKeyboard(lastPending.nonce),
          });
        });
    } else {
      logger.info(
        { BOT_DRY_RUN: true, chatId, keyboard: buildConfirmKeyboard(lastPending.tool, lastPending.argsHash, lastPending.nonce) },
        "BOT_DRY_RUN: would send confirm keyboard",
      );
    }
    session.turns.push({ role: "model", parts: [{ text: cleaned }] });
    persistSession(session);
    return;
  }

  // Plain text (or post-write) reply — keep it short on screen; voice carries the tone.
  if (result.text) {
    session.turns.push({ role: "model", parts: [{ text: result.text }] });
    await safeSend(bot, dryRun, chatId, result.text);
  } else {
    await safeSend(bot, dryRun, chatId, "تمام، خلصت.");
  }

  // Voice-first assistant: always try a short spoken reply unless model said VOICE_REPLY: no.
  if (preferVoice && result.voiceRequested && result.text && !dryRun && bot) {
    try {
      await bot.sendChatAction(chatId, "record_voice").catch(() => undefined);
      const audio = await synthesizeSpeech(result.text);
      if (audio) {
        if (audio.mimeType.includes("ogg")) {
          await bot.sendVoice(chatId, audio.bytes, {}, { filename: audio.filename, contentType: audio.mimeType });
        } else {
          await bot.sendAudio(
            chatId,
            audio.bytes,
            { title: "Promed", performer: "مساعد بروميد" },
            { filename: audio.filename, contentType: audio.mimeType },
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "voice reply failed; text only");
    }
  } else if (preferVoice && result.voiceRequested && dryRun) {
    logger.info({ BOT_DRY_RUN: true, chatId, text: result.text }, "BOT_DRY_RUN: would send voice");
  }

  // Roll up tool stats once per loop invocation.
  for (const tc of result.toolCalls) {
    writeToolStatsStub({
      tool_name: tc.name,
      ok: tc.ok,
    });
  }

  persistSession(session);
}

function extractSummary(text: string): string | null {
  const m = text.match(/CONFIRM_SUMMARY:\s*(.+)$/im);
  return m?.[1]?.trim() ?? null;
}

/** Turn MCP `content: [{type:'text', text: '...json...'}]` into a plain object for Gemini. */
function parseMcpContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content ?? { ok: true };
  const texts = content
    .filter((c): c is { type?: string; text: string } => !!c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text);
  if (texts.length === 0) return { ok: true, content };
  if (texts.length === 1) {
    const only = texts[0] ?? "";
    try {
      return JSON.parse(only);
    } catch {
      return { text: only };
    }
  }
  return { texts };
}

function summariseArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return "(no args)";
  return keys.map((k) => `${k}=${stringifyShort(args[k])}`).join(", ");
}

function stringifyShort(v: unknown): string {
  if (typeof v === "string") return v.length > 24 ? `${v.slice(0, 24)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 24 ? `${s.slice(0, 24)}…` : s;
  } catch {
    return "?";
  }
}

// Stub that posts to bot_tool_stats. The real rollup table expects bucket_5min
// which we compute here; production code would batch across multiple calls.
function writeToolStatsStub(input: { tool_name: string; ok: boolean }): void {
  void input;
  const bucket = fiveMinBucket();
  // We import lazily to avoid pulling audit.ts into hot path eagerly.
  // (writeToolStats already upserts on bucket+tool.)
  import("../audit.js").then(({ writeToolStats }) => {
    writeToolStats({
      bucketStart: bucket,
      toolName: input.tool_name,
      calls: 1,
      errors: input.ok ? 0 : 1,
      avgDurationMs: null,
    });
  });
}

// Re-export helper so index.ts can hit healthz status.
export { buildToolList };
