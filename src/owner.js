import { dns } from "../public/lib/dns-checks.js";

// 持ち主の確認。サーバーの秘密の値から作るので、確認の値は他人には作れない
export const RECORD_PREFIX = "_pb-migration-check";
const PROOF_TTL_MS = 60 * 60 * 1000;

async function hmac(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function challenge(secret, domain) {
  return { name: `${RECORD_PREFIX}.${domain}`, value: `pb-migration-check=${(await hmac(secret, `owner:${domain}`)).slice(0, 32)}` };
}

export async function isOwnerVerified(secret, domain, lookup = dns) {
  const { name, value } = await challenge(secret, domain);
  const records = (await lookup(name, "TXT")).map((t) => t.replace(/^"|"$/g, ""));
  return records.includes(value);
}

export async function issueProof(secret, domain, now = Date.now()) {
  const exp = now + PROOF_TTL_MS;
  return `${exp}.${await hmac(secret, `proof:${domain}:${exp}`)}`;
}

export async function isProofValid(secret, domain, proof, now = Date.now()) {
  const [expText, sig] = String(proof ?? "").split(".");
  const exp = Number(expText);
  if (!exp || !sig || exp < now) return false;
  return sig === (await hmac(secret, `proof:${domain}:${exp}`));
}
