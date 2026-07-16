import { createHash } from "node:crypto";
import type TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger.js";
import { RateLimiter } from "../ratelimit.js";
import { writeAudit, writeError, fiveMinBucket } from "../audit.js";
import { getMcpClient } from "../mcp/client.js";
import { getGemini, type GeminiInlinePart } from "../gemini/client.js";
import { buildToolList } from "../gemini/prompt.js";
import { getSession, persistSession, formatSessionContext, type Session } from "../session/store.js";
import { createLinkCode, resolveLink, touchLastSeen, relativeTime } from "./linking.js";
import { downloadTelegramFile, sendPdfToChat } from "./files.js";
import { synthesizeSpeech } from "../gemini/tts.js";

const WELCOME =
  "أهلاً بيك، معاك حسن من بروميد.\n" +
  "/link عشان تربط حسابك · /help للأوامر.\n" +
  "ابعتلي اسم العميل كتابة أو فويس وأنا أبعتلك كشف الحساب PDF.";

const HELP = [
  "/start — ترحيب",
  "/link — كود ربط الحساب (صالح 15 دقيقة)",
  "/whoami — مين الحساب المربوط",
  "/help — الرسالة دي",
  "",
  "شغلي دلوقتي: كشوف حساب العملاء PDF.",
  "قول مثلاً: «كشف حساب ام بي اس» — نص أو فويس.",
].join("\n");

function hashArgs(args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 16);
}

function sendText(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  // Plain text so arbitrary Gemini output (Markdown punctuation like _, *, [,
  // ], `, ~) doesn't trigger Telegram's "can't parse entities" Bad Request.
  return bot.sendMessage(chatId, text).then(() => undefined);
}

function notLinkedReply(): string {
  return "الحساب لسه مش مربوط. ابعت /link وخد الكود، ولصقه في Promed ← الإعدادات ← Telegram.";
}

/** Default Egyptian Arabic; English only if the message is clearly Latin-only. */
function detectLocaleHint(text: string): "en" | "ar" {
  const hasArabic = /[؀-ۿ]/.test(text);
  const hasLatin = /[A-Za-z]{3,}/.test(text);
  if (!hasArabic && hasLatin) return "en";
  return "ar";
}

/**
 * Per-chat turn queue. Without it, two quick voice notes are processed
 * concurrently and the replies (text + TTS voice) land out of order — the
 * user hears the answer to an OLD voice note after sending a new one.
 * Serializing per chat guarantees replies arrive in the order asked.
 */
const chatQueues = new Map<number, Promise<void>>();
function enqueueTurn(chatId: number, job: () => Promise<void>): void {
  const prev = chatQueues.get(chatId) ?? Promise.resolve();
  const next = prev.then(job, job);
  chatQueues.set(chatId, next);
  void next.finally(() => {
    if (chatQueues.get(chatId) === next) chatQueues.delete(chatId);
  });
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
      await safeSend(bot, dryRun, chatId, "ما قدرتش أعمل كود الربط دلوقتي. جرّب بعد شوية.");
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

  // Text messages.
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ?? "";
    if (text.startsWith("/")) return; // commands handled above
    if (msg.voice || msg.audio) return; // handled below
    if (msg.photo || msg.document) {
      await safeSend(
        bot,
        dryRun,
        chatId,
        "أنا شغال كشوف الحساب بس دلوقتي يا باشا — ابعتلي اسم العميل نص أو فويس.",
      );
      return;
    }
    if (!text.trim()) return;

    if (!rateLimiter.allow(chatId)) {
      await safeSend(bot, dryRun, chatId, "استنى شوية — كتير أوي في دقيقة.");
      return;
    }

    const link = await resolveLink(chatId).catch(() => null);
    if (!link) {
      await safeSend(bot, dryRun, chatId, notLinkedReply());
      return;
    }
    await touchLastSeen(chatId).catch(() => undefined);

    enqueueTurn(chatId, async () => {
      const session = await getSession(chatId);
      try {
        await bot.sendChatAction(chatId, "typing").catch(() => undefined);
        await handleUserTurn({
          bot,
          dryRun,
          chatId,
          userId: link.user_id,
          parts: [{ kind: "text", text }],
          session,
          latestText: text,
        });
      } catch (err) {
        writeError({ source: "telegram", severity: "error", message: (err as Error).message, ctx: { chatId } });
        await safeSend(bot, dryRun, chatId, "حصلت مشكلة مؤقتة. جرّب تاني كمان شوية.");
      }
    });
  });

  // Leftover inline-keyboard taps from the old confirm flow — just clear the
  // spinner; there is nothing to confirm in statements-only mode.
  bot.on("callback_query", async (q) => {
    await bot.answerCallbackQuery(q.id, { text: "" }).catch(() => undefined);
  });

  // Voice notes.
  bot.on("voice", async (msg) => {
    const chatId = msg.chat.id;
    if (!rateLimiter.allow(chatId)) {
      await safeSend(bot, dryRun, chatId, "استنى شوية — كتير أوي في دقيقة.");
      return;
    }
    const voice = msg.voice;
    if (!voice) return;
    const link = await resolveLink(chatId).catch(() => null);
    if (!link) {
      await safeSend(bot, dryRun, chatId, notLinkedReply());
      return;
    }
    await touchLastSeen(chatId).catch(() => undefined);

    enqueueTurn(chatId, async () => {
      const session = await getSession(chatId);
      try {
        await bot.sendChatAction(chatId, "record_voice").catch(() => undefined);
        const file = await downloadTelegramFile(bot, voice.file_id);
        // Transcribe FIRST in a dedicated call, then run the agent on plain
        // text. This makes intent detection and the statement safety-net
        // deterministic — the agent can never act (or claim to act) on audio
        // it silently ignored.
        const transcript = await getGemini().transcribe(
          file.mimeType,
          file.bytes.toString("base64"),
        );
        if (!transcript) {
          await safeSend(bot, dryRun, chatId, "معلش، ما سمعتش كلام واضح. قولها تاني أو اكتبهالي.");
          return;
        }
        logger.info({ chatId, transcript }, "voice note transcribed");
        await handleUserTurn({
          bot,
          dryRun,
          chatId,
          userId: link.user_id,
          parts: [{ kind: "text", text: transcript }],
          session,
          latestText: transcript,
          voiceReply: true,
        });
      } catch (err) {
        writeError({ source: "telegram", severity: "error", message: (err as Error).message, ctx: { chatId } });
        await safeSend(bot, dryRun, chatId, "ما قدرتش أسمع الرسالة الصوتية. ابعت تاني أو اكتب النص.");
      }
    });
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

// Deliberately narrow: only unambiguous statement requests. «حساب» alone or a
// bare client name must NOT auto-send a PDF (real users mention clients for
// balances, chit-chat, etc. — sending unrequested statements destroys trust).
const STATEMENT_INTENT_RE = /كشف|ستيتمنت|استيتمنت|ستاتمنت|statement|pdf/i;

// The model claiming it sent/will send a statement — used by the truth guard:
// a claim with no actual PDF delivery is either fulfilled by us or corrected.
const CLAIMS_SENT_RE = /(بعت|هبعت|ابعت|أرسلت|ارسلت|sent|sending).{0,30}(كشف|statement)|(كشف|statement).{0,30}(بعت|هبعت|أرسلت|ارسلت|sent)/i;

/** Strip statement keywords/filler from the request to guess the client name. */
function extractClientQuery(text: string): string | null {
  const cleaned = text
    .replace(/كشف حساب|كشف|الحساب|حساب|statement|pdf|ابعتلي|ابعت لي|ابعت|هاتلي|هات|اعملي|اعمل|اطلعلي|اطلع|طلعلي|طلع|عايز|عاوز|محتاج|ممكن|لو سمحت|من فضلك|يا حسن|يا باشا|بتاع|بتاعة|please|send|generate|the|for|of/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

type HandleArgs = {
  bot: TelegramBot;
  dryRun: boolean;
  chatId: number;
  userId: string;
  parts: GeminiInlinePart[];
  session: Session;
  latestText: string;
  /** True when the user spoke (voice note) — reply gets a TTS voice too. */
  voiceReply?: boolean;
};

async function handleUserTurn(args: HandleArgs): Promise<void> {
  const { bot, dryRun, chatId, userId, parts, session, latestText, voiceReply = false } = args;

  // Record the user turn. `session.turns` is text-only (audio bytes are sent
  // inline this round); we MUST keep at least one text part here or the next
  // conversation round replays an empty Content and the Gemini SDK throws
  // "Each Content should have at least one part" at startChat.
  const textParts = parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => ({ text: p.text }));
  const storedTextParts =
    textParts.length > 0 ? textParts : [{ text: latestText || "(non-text input)" }];
  session.turns.push({ role: "user", parts: storedTextParts });

  let tools;
  try {
    tools = await getMcpClient(userId, null).listTools();
  } catch (err) {
    writeError({ source: "mcp", severity: "error", message: (err as Error).message, ctx: { chatId } });
    await safeSend(bot, dryRun, chatId, "السيرفر مش جاهز دلوقتي. جرّب بعد شوية.");
    return;
  }

  const locale = detectLocaleHint(latestText);
  const sessionContext = formatSessionContext(session);

  // Track what list_clients actually returned this turn so the truth guard
  // below can finish the statement job if the model stalls after listing.
  let lastClients: Array<{ id: string; name: string | null }> = [];
  // Set only when a PDF was genuinely delivered to the chat this turn.
  let pdfSent = false;

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
        const start = Date.now();
        try {
          const r = await getMcpClient(userId, null).callTool(name, callArgs);
          const duration = Date.now() - start;
          writeAudit({
            chatId,
            userId,
            toolName: name,
            toolKind: "read",
            argsHash: h,
            ok: !r.isError,
            error: r.isError ? String(JSON.stringify(r.content)) : null,
            durationMs: duration,
          });
          if (r.isError) {
            writeError({
              source: "mcp",
              severity: "warn",
              message: `${name} returned error`,
              ctx: { chatId, tool: name, duration_ms: duration },
            });
          }

          // Parse MCP text content into a plain object so Gemini gets a Struct,
          // and so we can detect signed PDF URLs and deliver them to Telegram.
          const parsed = parseMcpContent(r.content);
          if (
            !r.isError &&
            name === "list_clients" &&
            parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { clients?: unknown }).clients)
          ) {
            // When the query matched nothing, list_clients returns the FULL
            // list "for disambiguation" (matched_via says so). Those are NOT
            // candidates — treating them as matches once sent the wrong
            // client's statement. Only capture genuine matches.
            const matchedVia = String((parsed as { matched_via?: unknown }).matched_via ?? "");
            const isGenuineMatch =
              matchedVia !== "" && matchedVia !== "all" && !matchedVia.startsWith("no exact match");
            lastClients = !isGenuineMatch
              ? []
              : ((parsed as { clients: Array<Record<string, unknown>> }).clients)
                  .filter((c) => c && (typeof c.id === "string" || typeof c.id === "number"))
                  .map((c) => ({ id: String(c.id), name: typeof c.name === "string" ? c.name : null }));
          }
          if (
            !r.isError &&
            !dryRun &&
            bot &&
            parsed &&
            typeof parsed === "object" &&
            typeof (parsed as { signedUrl?: unknown }).signedUrl === "string"
          ) {
            const signedUrl = (parsed as { signedUrl: string }).signedUrl;
            const filename = `statement-${String((callArgs as { client_id?: unknown }).client_id ?? "file")}.pdf`;
            await sendPdfToChat(bot, chatId, signedUrl, filename)
              .then(() => {
                pdfSent = true;
              })
              .catch((err) => {
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
            toolKind: "read",
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
    await safeSend(bot, dryRun, chatId, "ما قدرتش أكمل الطلب دلوقتي. جرّب تاني بعد شوية.");
    return;
  }

  let replyText = result.text;

  // TRUTH GUARD: the reply must never claim a statement was sent unless a PDF
  // actually reached the chat. Triggers when (a) the user explicitly asked for
  // a statement, or (b) the model CLAIMS it sent one — and no PDF went out.
  // We then do the job deterministically: resolve the client (using whatever
  // list_clients returned this turn, or our own lookup from the request text),
  // generate the statement, and send it. If we can't, we say so honestly.
  const statementIntent = STATEMENT_INTENT_RE.test(latestText);
  const claimsSent = CLAIMS_SENT_RE.test(replyText);
  if (!pdfSent && (statementIntent || claimsSent)) {
    logger.warn(
      { chatId, statementIntent, claimsSent, latestText, modelReply: replyText.slice(0, 120) },
      "TRUTH-GUARD: statement expected but no PDF delivered — taking over",
    );

    // Resolve candidate clients.
    let candidates = lastClients;
    if (candidates.length === 0) {
      const guess = extractClientQuery(latestText);
      if (guess) {
        try {
          const r = await getMcpClient(userId, null).callTool("list_clients", { q: guess });
          const parsed = parseMcpContent(r.content);
          if (
            !r.isError &&
            parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { clients?: unknown }).clients)
          ) {
            const matchedVia = String((parsed as { matched_via?: unknown }).matched_via ?? "");
            const isGenuineMatch =
              matchedVia !== "" && matchedVia !== "all" && !matchedVia.startsWith("no exact match");
            if (isGenuineMatch) {
              candidates = ((parsed as { clients: Array<Record<string, unknown>> }).clients)
                .filter((c) => c && (typeof c.id === "string" || typeof c.id === "number"))
                .map((c) => ({ id: String(c.id), name: typeof c.name === "string" ? c.name : null }));
            }
          }
          logger.info({ chatId, guess, found: candidates.length }, "TRUTH-GUARD: client lookup");
        } catch (err) {
          logger.warn({ chatId, err: (err as Error).message }, "TRUTH-GUARD: list_clients failed");
        }
      }
    }

    if (candidates.length > 0) {
      const target = candidates[0]!;
      const fbArgs = { client_id: target.id };
      const start = Date.now();
      try {
        const r = await getMcpClient(userId, null).callTool("generate_client_statement", fbArgs);
        const parsed = parseMcpContent(r.content);
        writeAudit({
          chatId,
          userId,
          toolName: "generate_client_statement",
          toolKind: "read",
          argsHash: hashArgs(fbArgs),
          ok: !r.isError,
          error: r.isError ? String(JSON.stringify(r.content)) : null,
          durationMs: Date.now() - start,
        });
        if (
          !r.isError &&
          parsed &&
          typeof parsed === "object" &&
          typeof (parsed as { signedUrl?: unknown }).signedUrl === "string"
        ) {
          if (!dryRun) {
            await sendPdfToChat(
              bot,
              chatId,
              (parsed as { signedUrl: string }).signedUrl,
              `statement-${target.id}.pdf`,
            );
          }
          pdfSent = true;
          replyText = `بعتلك كشف حساب ${target.name ?? `العميل ${target.id}`} ✅`;
          result.toolCalls.push({ name: "generate_client_statement", args: fbArgs, ok: true });
          logger.info({ chatId, clientId: target.id }, "TRUTH-GUARD: statement PDF delivered");
        }
      } catch (err) {
        writeError({
          source: "mcp",
          severity: "error",
          message: `truth-guard generate_client_statement failed: ${(err as Error).message}`,
          ctx: { chatId, clientId: target.id },
        });
      }
    }

    // Still nothing sent? Never let a false "sent it" through.
    if (!pdfSent) {
      replyText = "معلش، مش لاقي العميل ده — اكتبلي اسمه بالظبط وأنا أبعتلك الكشف على طول.";
    }
  }

  // Remember what the user asked + which tools ran, so follow-ups like
  // «نفس الطلب» / «اللي فات» work even after restarts / voice-only turns.
  if (result.toolCalls.length > 0) {
    session.lastToolSummary = result.toolCalls
      .map((tc) => `${tc.name}(${summariseArgs(tc.args)})${tc.ok ? "" : " ERR"}`)
      .join("; ");
  }
  // Keep a human intent string — voice notes are transcribed upstream, so
  // latestText is always real user words here.
  if (latestText && latestText !== "(non-text input)") {
    session.lastUserIntent = latestText;
  }

  // Send the reply — text first, then optional voice.
  if (replyText) {
    session.turns.push({ role: "model", parts: [{ text: replyText }] });
    await safeSend(bot, dryRun, chatId, replyText);
  } else {
    await safeSend(bot, dryRun, chatId, "تمام، خلصت.");
  }

  // Voice in → voice out; text in → text only. Sending a TTS voice note for
  // every reply made Telegram's autoplay chain older bot voices after each
  // playback — replying in kind keeps the chat clean.
  if (voiceReply && result.voiceRequested && replyText && !dryRun && bot) {
    try {
      await bot.sendChatAction(chatId, "record_voice").catch(() => undefined);
      const audio = await synthesizeSpeech(replyText);
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
  } else if (voiceReply && result.voiceRequested && dryRun) {
    logger.info({ BOT_DRY_RUN: true, chatId, text: replyText }, "BOT_DRY_RUN: would send voice");
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
