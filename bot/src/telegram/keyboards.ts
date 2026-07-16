import type { InlineKeyboardMarkup } from "node-telegram-bot-api";

export function buildConfirmKeyboard(
  tool: string,
  argsHash: string,
  nonce: string,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Confirm", callback_data: `confirm:${tool}:${argsHash}:${nonce}` },
        { text: "Cancel", callback_data: `cancel:${nonce}` },
      ],
    ],
  };
}

export function buildCancelKeyboard(nonce: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Cancel", callback_data: `cancel:${nonce}` },
      ],
    ],
  };
}

export function parseCallbackData(data: string):
  | { kind: "confirm"; tool: string; argsHash: string; nonce: string }
  | { kind: "cancel"; nonce: string }
  | { kind: "edit"; nonce: string }
  | { kind: "unknown"; raw: string } {
  const parts = data.split(":");
  if (parts.length < 2) return { kind: "unknown", raw: data };
  const [head, ...rest] = parts;
  if (head === "confirm" && rest.length >= 3) {
    const [tool, argsHash, ...nonceParts] = rest;
    return { kind: "confirm", tool: tool ?? "", argsHash: argsHash ?? "", nonce: nonceParts.join(":") };
  }
  if (head === "cancel") {
    return { kind: "cancel", nonce: rest.join(":") };
  }
  if (head === "edit") {
    return { kind: "edit", nonce: rest.join(":") };
  }
  return { kind: "unknown", raw: data };
}

export function isYesDelete(text: string): boolean {
  return text.trim().toLowerCase() === "yes, delete";
}
