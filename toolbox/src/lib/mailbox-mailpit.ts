import type { Mailbox, RawMail } from "./mailbox.ts";
import type { MailServer } from "./mailbox.ts";

/**
 * Mailpit, the mail catcher of a site that runs on this machine, over its REST API. Mailpit has no
 * IMAP; POP3 must be switched on apart and shows only the last hundred messages. Only on this
 * machine (see `decideMailbox`): the API has no login here.
 */

const SEARCH_LIMIT = 50;
const TIMEOUT_MS = 10_000;

export function mailpitMailbox(server: MailServer): Mailbox {
  const base = `http://${server.host.includes(":") ? `[${server.host}]` : server.host}:${server.port}/api/v1`;
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Mailpit antwoordt met ${response.status}`);
    return response;
  };
  return {
    kind: "mailpit",
    fetch: async (address, since) => {
      const query = new URLSearchParams({ query: `addressed:"${address.replaceAll('"', "")}"`, limit: String(SEARCH_LIMIT) });
      const found = (await (await call(`/search?${query}`)).json()) as { messages?: { ID: string; Created: string }[] };
      const recent = (found.messages ?? []).filter((message) => Date.parse(message.Created) >= since.getTime());
      return Promise.all(recent.map(async (message): Promise<RawMail> => ({ id: message.ID, receivedAt: Date.parse(message.Created), raw: Buffer.from(await (await call(`/message/${encodeURIComponent(message.ID)}/raw`)).arrayBuffer()) })));
    },
    remove: async (ids) => {
      if (ids.length === 0) return 0;
      await call("/messages", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: ids }) });
      return ids.length;
    },
  };
}
