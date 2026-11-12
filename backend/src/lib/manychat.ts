// ManyChat API (Bright, 12 Nov 2026: Social Leads Inbox). Reps reply from
// Protohub; ManyChat delivers the message in Messenger / Instagram.
// Needs a ManyChat Pro account; the key is Settings › API in ManyChat.

// MANYCHAT_API_BASE lets the local sandbox point at a stand-in; never set in production.
const BASE = (process.env.MANYCHAT_API_BASE || "https://api.manychat.com").replace(/\/+$/, "");

type Result<T> = { ok: true; data: T } | { ok: false; message: string; status?: number };

async function call<T>(apiKey: string, method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok || json?.status === "error") {
      const detail = json?.message || json?.details?.messages?.[0]?.message || json?.details?.message;
      return { ok: false, status: response.status, message: plainError(response.status, detail) };
    }
    return { ok: true, data: (json?.data ?? json) as T };
  } catch (error: any) {
    return { ok: false, message: error?.name === "TimeoutError" ? "ManyChat did not answer in 15 seconds." : "Could not reach ManyChat." };
  }
}

function plainError(status: number, detail: unknown) {
  const text = String(detail ?? "");
  if (status === 401 || status === 403) return "ManyChat refused the API key. Copy it again from ManyChat › Settings › API (a Pro account is needed).";
  if (/24.?hour|outside.*window|message_tag|messaging window/i.test(text)) return "The customer's 24-hour window has closed, so Meta does not allow this message.";
  if (/subscriber.*(not found|does not exist)/i.test(text)) return "ManyChat no longer has this contact.";
  return text ? `ManyChat: ${text.slice(0, 200)}` : `ManyChat returned an error (${status}).`;
}

export type PageInfo = { id: number | string; name: string; is_pro?: boolean };
/** Is the key good? Returns the Page it belongs to. */
export const pageInfo = (apiKey: string) => call<PageInfo>(apiKey, "GET", "/fb/page/getInfo");

export type Subscriber = { id: string; name?: string; first_name?: string; last_name?: string; profile_pic?: string; phone?: string; whatsapp_phone?: string; email?: string; ig_username?: string; ig_id?: string | number; live_chat_url?: string; last_interaction?: string };
export const subscriberInfo = (apiKey: string, subscriberId: string) =>
  call<Subscriber>(apiKey, "GET", `/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`);

export type OutMessage =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "cards"; elements: Array<{ title: string; subtitle?: string; image_url?: string; buttons?: Array<{ type: "url"; caption: string; url: string }> }>; image_aspect_ratio?: "horizontal" | "square" };

/**
 * Send to one contact. Inside 24 hours no tag is needed; after that only a
 * person may write, for up to 7 days, with the HUMAN_AGENT tag.
 */
export function sendContent(apiKey: string, input: { subscriberId: string; platform: "facebook" | "instagram" | "messenger"; messages: OutMessage[]; humanAgentTag?: boolean }) {
  const content: Record<string, unknown> = { messages: input.messages };
  if (input.platform === "instagram") content.type = "instagram";
  return call<unknown>(apiKey, "POST", "/fb/sending/sendContent", {
    subscriber_id: input.subscriberId,
    data: { version: "v2", content },
    ...(input.humanAgentTag ? { message_tag: "HUMAN_AGENT" } : {})
  });
}

/**
 * Tell ManyChat's flows a person is handling this contact (custom field
 * "protohub_human" = true/false). The Default Reply flow checks it so the bot
 * stays quiet while a rep chats.
 */
export const setHumanHandling = (apiKey: string, subscriberId: string, on: boolean) =>
  call<unknown>(apiKey, "POST", "/fb/subscriber/setCustomFieldByName", { subscriber_id: subscriberId, field_name: "protohub_human", field_value: on });

export type Flow = { ns: string; name: string; folder_id?: number };
/** The Page's flows (Automations › Sync from ManyChat). */
export const pageFlows = (apiKey: string) => call<{ flows: Flow[] }>(apiKey, "GET", "/fb/page/getFlows");
