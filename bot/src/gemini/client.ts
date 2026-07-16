import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  type Content,
  type GenerateContentResult,
  type Part,
} from "@google/generative-ai";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";
import { setGeminiOk, setLastError } from "../healthz.js";
import { buildSystemPrompt } from "./prompt.js";

export type GeminiInlinePart =
  | { kind: "text"; text: string }
  | { kind: "audio"; mimeType: string; base64: string }
  | { kind: "image"; mimeType: string; base64: string };

export type GeminiTurn =
  | { role: "user"; parts: GeminiInlinePart[] }
  | { role: "model"; text: string }
  | { role: "function"; name: string; response: unknown };

export type GeminiLoopResult = {
  text: string;
  voiceRequested: boolean;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; ok: boolean }>;
};

const MAX_ROUNDS = 6;

export class GeminiClient {
  private readonly genai: GoogleGenerativeAI;
  private readonly modelId: string;

  constructor(apiKey: string, modelId: string) {
    this.genai = new GoogleGenerativeAI(apiKey);
    this.modelId = modelId;
  }

  static fromEnv(): GeminiClient {
    const cfg = loadConfig();
    return new GeminiClient(cfg.GEMINI_API_KEY, cfg.GEMINI_MODEL);
  }

  /** Convert MCP tool definitions into Gemini functionDeclarations. */
  static toFunctionDeclarations(tools: McpTool[]): FunctionDeclaration[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema as FunctionDeclaration["parameters"],
    }));
  }

  /** Run a multi-round generateContent loop with tool-calling. */
  async runLoop(opts: {
    locale?: "en" | "ar" | "auto";
    tools: McpTool[];
    history: GeminiTurn[];
    userParts: GeminiInlinePart[];
    callMcpTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  }): Promise<GeminiLoopResult> {
    const { tools, history, userParts, callMcpTool, locale = "auto" } = opts;
    const sysPrompt = buildSystemPrompt(locale);
    const declarations = GeminiClient.toFunctionDeclarations(tools);

    const model = this.genai.getGenerativeModel({
      model: this.modelId,
      systemInstruction: sysPrompt,
      tools: declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined,
    });

    const chat = model.startChat({ history: toGeminiHistory(history) });

    const toolCalls: GeminiLoopResult["toolCalls"] = [];
    let finalText = "";
    let voiceRequested = false;
    let currentParts = toGeminiParts(userParts);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      let res: GenerateContentResult;
      try {
        res = await chat.sendMessage(currentParts as Array<string | Part>);
        setGeminiOk(true);
        setLastError(null);
      } catch (err) {
        setGeminiOk(false);
        setLastError(`gemini sendMessage: ${(err as Error).message}`);
        throw err;
      }

      const cand = res.response.candidates?.[0];
      const content: Content | undefined = cand?.content;
      const parts: Part[] = content?.parts ?? [];
      const fnCalls = parts.filter((p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } =>
        Boolean((p as { functionCall?: unknown }).functionCall),
      );
      const textParts = parts.filter((p) => typeof (p as { text?: unknown }).text === "string");

      if (fnCalls.length === 0) {
        finalText = textParts.map((p) => (p as { text: string }).text).join("");
        voiceRequested = detectVoiceRequest(finalText);
        // Strip the trailing VOICE_REPLY marker line if present so it isn't shown verbatim.
        finalText = stripVoiceMarker(finalText);
        break;
      }

      // Send the model's turn back into the chat, then handle function calls.
      currentParts = [];

      for (const fc of fnCalls) {
        const { name, args } = fc.functionCall;
        let parsedArgs: Record<string, unknown> = {};
        if (args && typeof args === "object") parsedArgs = args as Record<string, unknown>;

        let ok = true;
        let responsePayload: unknown;
        try {
          responsePayload = await callMcpTool(name, parsedArgs);
        } catch (err) {
          ok = false;
          responsePayload = { error: (err as Error).message };
        }
        toolCalls.push({ name, args: parsedArgs, ok });

        // Provide a functionResponse back to Gemini so it can continue the turn.
        await chat.sendMessage([
          {
            functionResponse: {
              name,
              response: responsePayload as Record<string, unknown>,
            },
          } as unknown as Part,
        ]);
      }

      // Continue the outer loop: next iteration will send an empty "user" message,
      // which asks the model to summarize after seeing the function responses.
      currentParts = [{ text: "Continue." } as Part];
    }

    return { text: finalText, voiceRequested, toolCalls };
  }
}

function toGeminiHistory(history: GeminiTurn[]): Content[] {
  const out: Content[] = [];
  for (const t of history) {
    if (t.role === "user") {
      out.push({
        role: "user",
        parts: t.parts.map((p): Part => {
          if (p.kind === "text") return { text: p.text };
          return { inlineData: { mimeType: p.mimeType, data: p.base64 } };
        }),
      });
    } else if (t.role === "model") {
      out.push({ role: "model", parts: [{ text: t.text }] as Part[] });
    }
    // function turns are replayed by runLoop via functionResponse, not via history.
  }
  return out;
}

function toGeminiParts(parts: GeminiInlinePart[]): Part[] {
  return parts.map((p): Part => {
    if (p.kind === "text") return { text: p.text };
    if (p.kind === "audio") return { inlineData: { mimeType: p.mimeType, data: p.base64 } };
    return { inlineData: { mimeType: p.mimeType, data: p.base64 } };
  });
}

function detectVoiceRequest(text: string): boolean {
  const m = text.match(/^VOICE_REPLY:\s*(yes|no)/im);
  return Boolean(m && m[1]?.toLowerCase() === "yes");
}

function stripVoiceMarker(text: string): string {
  return text.replace(/\n?VOICE_REPLY:\s*(yes|no)\s*$/im, "").trim();
}

let _gemini: GeminiClient | null = null;
export function getGemini(): GeminiClient {
  if (!_gemini) {
    _gemini = GeminiClient.fromEnv();
    logger.info({ model: loadConfig().GEMINI_MODEL }, "gemini client initialised");
  }
  return _gemini;
}
