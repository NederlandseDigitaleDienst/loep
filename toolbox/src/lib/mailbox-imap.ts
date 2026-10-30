import { connect as plainConnect, isIP, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { Mailbox, MailCredentials, RawMail } from "./mailbox.ts";
import type { MailServer } from "./shield.ts";

/**
 * A mailbox over IMAP (RFC 9051), with the few commands this flow needs: find what came in for an
 * address, read it without marking it as read, and delete those messages and no others. A new
 * connection per round: a wait lasts minutes and a held connection is one more thing that breaks.
 * Port 993 is TLS from the first byte and the certificate is checked. Without TLS only on this
 * machine (see `decideMailbox`).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A message larger than this is read up to here: a mail with a link does not need more. */
const MAX_MESSAGE_BYTES = 1_048_576;
const TIMEOUT_MS = 30_000;

/** A string as IMAP quotes it. A line break would end the command, so it is refused and not escaped. */
function quoted(text: string): string {
  if (/[\r\n\0]/.test(text)) throw new Error("een regeleinde hoort niet in een gebruikersnaam, wachtwoord of adres");
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The date of a search: the server keeps its own day, so a day earlier and the exact time is checked afterwards. */
const searchDate = (since: Date): string => {
  const day = new Date(since.getTime() - 86_400_000);
  return `${day.getUTCDate()}-${MONTHS[day.getUTCMonth()]}-${day.getUTCFullYear()}`;
};

interface Reply {
  /** The untagged lines, each with the literals that came with it. */
  lines: { text: string; literals: Buffer[] }[];
  status: string;
}

class Connection {
  private buffer = Buffer.alloc(0);
  private waiting: (() => void) | null = null;
  private failure: Error | null = null;
  private tag = 0;
  private readonly socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("geen antwoord van de mailserver binnen de tijd")));
    socket.on("data", (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.wake();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.wake();
    });
    socket.on("close", () => {
      this.failure ??= new Error("de mailserver verbrak de verbinding");
      this.wake();
    });
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.();
  }

  private async more(): Promise<void> {
    if (this.failure) throw this.failure;
    await new Promise<void>((resolve) => (this.waiting = resolve));
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf("\r\n");
      if (end !== -1) {
        const line = this.buffer.subarray(0, end).toString("latin1");
        this.buffer = this.buffer.subarray(end + 2);
        return line;
      }
      await this.more();
    }
  }

  private async readBytes(count: number): Promise<Buffer> {
    while (this.buffer.length < count) await this.more();
    const bytes = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return bytes;
  }

  /** One line of the server with the literals (`{123}`) inside it. */
  private async readResponse(): Promise<{ text: string; literals: Buffer[] }> {
    let text = await this.readLine();
    const literals: Buffer[] = [];
    for (;;) {
      const literal = /\{(\d+)\}$/.exec(text);
      if (!literal) return { text, literals };
      const size = Number(literal[1]);
      if (size > MAX_MESSAGE_BYTES * 2) throw new Error("de mailserver stuurt meer dan is gevraagd");
      literals.push(await this.readBytes(size));
      text += await this.readLine();
    }
  }

  /** Wait for the greeting of the server. */
  async greeting(): Promise<void> {
    const { text } = await this.readResponse();
    if (!/^\* (OK|PREAUTH)\b/i.test(text)) throw new Error("de mailserver weigert de verbinding");
  }

  /** Send a command and read until its own tag comes back. The command is never put in an error: it can hold a password. */
  async run(command: string, what: string): Promise<Reply> {
    const tag = `L${++this.tag}`;
    this.socket.write(`${tag} ${command}\r\n`);
    const lines: Reply["lines"] = [];
    for (;;) {
      const response = await this.readResponse();
      if (response.text.startsWith(`${tag} `)) {
        const status = response.text.slice(tag.length + 1);
        if (!/^OK\b/i.test(status)) throw new Error(`de mailserver weigerde ${what}`);
        return { lines, status };
      }
      lines.push(response);
    }
  }

  close(): void {
    this.socket.end();
    this.socket.destroy();
  }
}

/** The numbers after `* SEARCH`. */
const searchResults = (reply: Reply): string[] => reply.lines.flatMap((line) => (/^\* SEARCH\b/i.test(line.text) ? line.text.replace(/^\* SEARCH\s*/i, "").trim().split(/\s+/).filter(Boolean) : []));

/** The messages of a `FETCH` reply: its UID, the moment it came in and the message itself. */
function fetchedMessages(reply: Reply): RawMail[] {
  return reply.lines.flatMap((line) => {
    const uid = /\bUID (\d+)/i.exec(line.text)?.[1];
    const date = /\bINTERNALDATE "([^"]+)"/i.exec(line.text)?.[1];
    const raw = line.literals[0];
    if (!uid || !raw) return [];
    const received = date ? Date.parse(date) : Number.NaN;
    // A date that cannot be read may not make a message disappear: without one it counts as just arrived.
    return [{ id: uid, receivedAt: Number.isNaN(received) ? Date.now() : received, raw }];
  });
}

export function imapMailbox(server: MailServer, credentials: MailCredentials): Mailbox {
  const session = async <T>(work: (connection: Connection, capabilities: string) => Promise<T>): Promise<T> => {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const options = { host: server.host, port: server.port };
      const opened = server.tls ? tlsConnect({ ...options, ...(isIP(server.host) ? {} : { servername: server.host }) }) : plainConnect(options);
      opened.once(server.tls ? "secureConnect" : "connect", () => resolve(opened));
      opened.once("error", reject);
    });
    const connection = new Connection(socket);
    try {
      await connection.greeting();
      await connection.run(`LOGIN ${quoted(credentials.user)} ${quoted(credentials.password)}`, "de inlog");
      const capabilities = (await connection.run("CAPABILITY", "de vraag wat hij kan")).lines.map((line) => line.text).join(" ");
      await connection.run("SELECT INBOX", "het openen van de postbus");
      const result = await work(connection, capabilities);
      await connection.run("LOGOUT", "het afmelden").catch(() => undefined);
      return result;
    } finally {
      connection.close();
    }
  };
  const find = (flag: "UNDELETED" | "DELETED", address: string, since: Date): Promise<RawMail[]> =>
    session(async (connection) => {
      const uids = searchResults(await connection.run(`UID SEARCH ${flag} SINCE ${searchDate(since)} TO ${quoted(address)}`, "het zoeken"));
      if (uids.length === 0) return [];
      // A peek leaves the message unread: reading is not what this flow is there to change.
      return fetchedMessages(await connection.run(`UID FETCH ${uids.join(",")} (UID INTERNALDATE BODY.PEEK[]<0.${MAX_MESSAGE_BYTES}>)`, "het ophalen"));
    });
  return {
    kind: "imap",
    fetch: (address, since) => find("UNDELETED", address, since),
    // A server without UIDPLUS keeps what was marked; `mailCleanup` says so instead of calling it gone.
    marked: (address, since) => find("DELETED", address, since),
    remove: (ids) =>
      ids.length === 0
        ? Promise.resolve(0)
        : session(async (connection, capabilities) => {
            const set = ids.join(",");
            await connection.run(`UID STORE ${set} +FLAGS.SILENT (\\Deleted)`, "het verwijderen");
            // Without UIDPLUS an EXPUNGE would also wipe what somebody else marked: the mark stays, and search skips it.
            if (/\bUIDPLUS\b/i.test(capabilities)) await connection.run(`UID EXPUNGE ${set}`, "het wissen");
            return ids.length;
          }),
  };
}
