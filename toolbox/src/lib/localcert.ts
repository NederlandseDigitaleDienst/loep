import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

/*
 * A certificate for the boundary of `browser/shielded.ts`: the browser of a run with a mailbox talks
 * to the boundary on this machine, and the boundary checks the real certificate of the site. It is
 * made per process and never leaves it. Node can read certificates but not make them, and an
 * extra package or a call to `openssl` is more than these few fields are worth.
 */

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const size = body.length < 0x80 ? [body.length] : body.length < 0x100 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 0xff];
  return Buffer.concat([Buffer.from([tag, ...size]), body]);
}

const SEQUENCE = 0x30;
const SET = 0x31;
const ECDSA_WITH_SHA256 = der(SEQUENCE, der(0x06, Buffer.from("2a8648ce3d040302", "hex")));
const COMMON_NAME = der(0x06, Buffer.from("550403", "hex"));
const DAY_MS = 86_400_000;

/** A time as X.509 writes it up to 2049. */
const utcTime = (moment: Date): Buffer => der(0x17, Buffer.from(`${moment.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`));

const pem = (label: string, data: Buffer): string => `-----BEGIN ${label}-----\n${data.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

/** A fresh key and a self-signed certificate that holds for a year. */
export function localCertificate(now = new Date()): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const name = der(SEQUENCE, der(SET, der(SEQUENCE, COMMON_NAME, der(0x0c, Buffer.from("loep")))));
  const serial = randomBytes(16);
  serial[0] = serial[0]! & 0x7f;
  const tbs = der(SEQUENCE, der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), ECDSA_WITH_SHA256, name, der(SEQUENCE, utcTime(new Date(now.getTime() - DAY_MS)), utcTime(new Date(now.getTime() + 365 * DAY_MS))), name, publicKey.export({ type: "spki", format: "der" }));
  const signature = sign("sha256", tbs, privateKey);
  const certificate = der(SEQUENCE, tbs, ECDSA_WITH_SHA256, der(0x03, Buffer.from([0]), signature));
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }) as string, cert: pem("CERTIFICATE", certificate) };
}
