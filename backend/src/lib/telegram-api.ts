// ── Telegram Bot API client (Bright, 6 Nov 2026) ───────────────────────────
// Plain HTTPS calls to api.telegram.org: no session is kept in memory, so a
// deploy never logs the bot out (unlike the WhatsApp runtime). Telegram does
// not charge for bot messages.

// TELEGRAM_API_BASE: a stand-in Telegram for local testing only.
const API = (process.env.TELEGRAM_API_BASE?.trim() || "https://api.telegram.org").replace(/\/+$/, "");
const TIMEOUT_MS = 15_000;

export type TgResult<T> = { ok: true; result: T } | { ok: false; error: string; code?: number; retryAfter?: number };

export type TgButton = { text: string; url?: string; callback_data?: string };
export type TgKeyboard = TgButton[][];

export type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
export type TgChat = { id: number; type: string; title?: string; username?: string; first_name?: string };
export type TgMessage = { message_id: number; chat: TgChat; from?: TgUser; text?: string; date: number };
export type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };
export type TgWebhookInfo = { url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string };

/** One Bot API call. Never throws: a failure comes back as { ok: false }. */
export async function tgCall<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal
    });
    const json = await response.json().catch(() => null) as any;
    if (json?.ok) return { ok: true, result: json.result as T };
    return {
      ok: false,
      error: String(json?.description ?? `Telegram answered ${response.status}`),
      code: Number(json?.error_code ?? response.status) || undefined,
      retryAfter: Number(json?.parameters?.retry_after) || undefined
    };
  } catch (error) {
    // The token is part of the URL: never echo the raw fetch error.
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "Telegram did not answer in time." : "Could not reach Telegram." };
  } finally {
    clearTimeout(timer);
  }
}

export const tgGetMe = (token: string) => tgCall<TgUser>(token, "getMe");

export const tgSetWebhook = (token: string, url: string, secret: string) => tgCall<boolean>(token, "setWebhook", {
  url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true
});

export const tgDeleteWebhook = (token: string) => tgCall<boolean>(token, "deleteWebhook", { drop_pending_updates: true });

export const tgWebhookInfo = (token: string) => tgCall<TgWebhookInfo>(token, "getWebhookInfo");

export const tgSetCommands = (token: string, commands: Array<{ command: string; description: string }>) =>
  tgCall<boolean>(token, "setMyCommands", { commands });

/** silent: arrives without a sound (quiet hours); it is still there to read. */
export function tgSendMessage(token: string, chatId: string | number, text: string, keyboard?: TgKeyboard, silent = false) {
  return tgCall<TgMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(silent ? { disable_notification: true } : {}),
    ...(keyboard && keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {})
  });
}

export const tgAnswerCallback = (token: string, callbackId: string, text?: string) =>
  tgCall<boolean>(token, "answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });

/** Text safe inside a parse_mode=HTML message. */
export function tgEscape(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A bot token looks like 123456789:AAE... (digits, colon, 30+ characters). */
export function looksLikeBotToken(value: string) {
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(value.trim());
}
