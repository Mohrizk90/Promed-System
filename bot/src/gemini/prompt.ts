import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

export type Locale = "en" | "ar" | "auto";

export function buildSystemPrompt(locale: Locale = "auto"): string {
  const langLine =
    locale === "ar"
      ? "Always reply in Arabic."
      : locale === "en"
        ? "Always reply in English."
        : "Reply in the same language as the user's latest message (English or Arabic).";
  return [
    "You are the Promed ERP assistant for one authorized user.",
    "",
    "Rules:",
    `- ${langLine}`,
    "- Use the supplied MCP tools to answer questions and perform actions.",
    "- Never invent IDs, balances, or invoice numbers. If data is missing, ask one short clarifying question.",
    "- For read tools, call them directly.",
    "- For write tools (create/update/delete), DO NOT call them directly. Instead, produce a confirmation summary in the user's language, ending with `CONFIRM_SUMMARY: <one-line summary>` and `VOICE_REPLY: yes|no`. The bot will request user confirmation and re-invoke you with `confirmed: true`.",
    '- Deletes require the user to type "yes, delete" after clicking Confirm.',
    "- For reads, prefer short tables (id, name, total) over prose.",
    "- For successful writes, return one sentence plus the new id/row.",
    "- Currency and dates follow en-GB conventions unless the user writes in Arabic (then use Arabic conventions and EGP).",
    "",
    "Available tools will be listed below.",
  ].join("\n");
}

export function buildToolList(tools: McpTool[]): string {
  if (!tools.length) return "(no tools available)";
  return tools
    .map((t) => {
      const desc = t.description?.trim() || "(no description)";
      let input = "(no input)";
      try {
        input = JSON.stringify(t.inputSchema, null, 2);
      } catch {
        // ignore — leave default
      }
      return `- ${t.name}: ${desc}\n  Input: ${input}`;
    })
    .join("\n\n");
}
