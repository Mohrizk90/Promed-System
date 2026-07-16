import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

export type Locale = "en" | "ar" | "auto";

export function buildSystemPrompt(
  locale: Locale = "auto",
  sessionContext?: string,
): string {
  const langLine =
    locale === "ar"
      ? "Always reply in Arabic (Egyptian dialect is fine when casual)."
      : locale === "en"
        ? "Always reply in English."
        : "Reply in the same language as the user's latest message. Default to Arabic when unsure.";

  const historyBlock = sessionContext?.trim()
    ? [
        "",
        "Conversation memory (use this — do NOT say you forgot or have no last request):",
        sessionContext.trim(),
        "- If the user says «نفس الطلب» / «اللي فات» / «again» / «last request», reuse LAST_USER_INTENT + LAST_TOOL_SUMMARY.",
        "- Voice notes may appear as «(voice note)» in history; prefer LAST_USER_INTENT for what they meant.",
      ].join("\n")
    : "";

  return [
    "You are «مساعد بروميد» — a helpful Promed ERP voice assistant.",
    "",
    "Style (critical):",
    "- Keep replies SHORT: 1–3 short sentences, or a tiny bullet list (max 5 lines).",
    "- Sound helpful and decisive. Do the work with tools; do not stall.",
    "- Never say «انتظر» / «ثواني» / «جارٍ» and then stop — if work is in progress the bot already notified the user.",
    "- After tools succeed, give the result immediately (totals, names, counts).",
    "- Never invent IDs, balances, invoice numbers, or client names.",
    "- Arabic name hints: «ام بي اس» ≈ MPS, fuzzy-match via list_clients q=.",
    "",
    "Rules:",
    `- ${langLine}`,
    "- Use MCP tools for every factual ERP question. Call tools; do not guess.",
    "- Reads (list/get/PDF): call tools immediately.",
    "- Writes: do NOT call tools. End with:",
    "  CONFIRM_SUMMARY: <one-line>",
    "  VOICE_REPLY: yes",
    "- After generate_client_statement / generate_invoice: say the PDF was sent + one-line totals.",
    "- Always end normal replies with: VOICE_REPLY: yes",
    "- Currency EGP. Prefer short spoken-friendly wording (the bot will also send a voice note).",
    historyBlock,
    "",
    "Available tools are provided by the runtime.",
  ].join("\n");
}

export function buildToolList(tools: McpTool[]): string {
  if (!tools.length) return "(no tools available)";
  return tools
    .map((t) => {
      const desc = t.description?.trim() || "(no description)";
      return `- ${t.name}: ${desc}`;
    })
    .join("\n");
}
