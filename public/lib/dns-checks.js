import { CLOUDFLARE_TLDS, CLOUDFLARE_TLDS_CHECKED } from "./tlds.js";

// このファイルは利用者のブラウザでも、サーバーでも、手元のコマンドでも同じものが動く
const TIMEOUT_MS = 8000;

const JP_SLD = new Set(["co", "or", "ne", "ac", "ad", "ed", "go", "gr", "lg"]);
const JP_PREF = new Set([
  "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima", "ibaraki", "tochigi", "gunma",
  "saitama", "chiba", "tokyo", "kanagawa", "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano",
  "gifu", "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo", "nara", "wakayama", "tottori",
  "shimane", "okayama", "hiroshima", "yamaguchi", "tokushima", "kagawa", "ehime", "kochi", "fukuoka", "saga",
  "nagasaki", "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
]);
const OTHER_SLD = { uk: ["co", "org", "me", "ltd", "plc"], au: ["com", "net", "org"], nz: ["co", "net", "org"] };

const MAIL_PROVIDERS = [
  { match: /(aspmx\.l\.google\.com|googlemail\.com|smtp\.google\.com)\.?$/, name: "Google Workspace", kind: "hosted" },
  { match: /mail\.protection\.outlook\.com\.?$/, name: "Microsoft 365", kind: "hosted" },
  { match: /mx\.cloudflare\.net\.?$/, name: "Cloudflare Email Routing（転送のみ）", kind: "forwarding" },
  { match: /zoho\.(com|jp|eu)\.?$/, name: "Zoho Mail", kind: "hosted" },
  { match: /amazonaws\.com\.?$/, name: "Amazon（SES など）", kind: "hosted" },
  { match: /mail\.icloud\.com\.?$/, name: "iCloud メール", kind: "hosted" },
  { match: /messagingengine\.com\.?$/, name: "Fastmail", kind: "hosted" },
  { match: /(pphosted\.com|mimecast\.com|messagelabs\.com)\.?$/, name: "メールの受け口の中継サービス", kind: "gateway" },
  { match: /xserver\.jp\.?$/, name: "エックスサーバー", kind: "rental" },
  { match: /sakura\.ne\.jp\.?$/, name: "さくらインターネット", kind: "rental" },
  { match: /(lolipop\.jp|heteml\.jp)\.?$/, name: "ロリポップ／ヘテムル", kind: "rental" },
  { match: /(conoha\.io|conoha\.jp)\.?$/, name: "ConoHa", kind: "rental" },
  { match: /(gmoserver\.jp|rentalserver\.jp|onamae\.com)\.?$/, name: "お名前.com の系列のサーバー", kind: "rental" },
  { match: /(kagoya\.net|kagoya\.jp)\.?$/, name: "カゴヤ", kind: "rental" },
  { match: /gmo\.jp\.?$/, name: "GMO 系のサーバー（ConoHa など）", kind: "rental" },
  { match: /(coreserver\.jp|value-domain\.com|star\.ne\.jp|mixhost\.jp|cpi\.ad\.jp)\.?$/, name: "レンタルサーバー", kind: "rental" },
];

const NS_PROVIDERS = [
  { match: /ns\.cloudflare\.com\.?$/, name: "Cloudflare" },
  { match: /(onamae\.com|dnsv\.jp)\.?$/, name: "お名前.com" },
  { match: /xserver\.jp\.?$/, name: "エックスサーバー" },
  { match: /dns\.ne\.jp\.?$/, name: "さくらインターネット" },
  { match: /awsdns/, name: "Amazon Route 53" },
  { match: /(googledomains\.com|google\.com)\.?$/, name: "Google" },
  { match: /value-domain\.com\.?$/, name: "バリュードメイン" },
  { match: /gmointernet\.jp\.?$/, name: "GMO インターネット" },
];

export class InputError extends Error {}

export function normalizeHost(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new InputError("URL を入れてください");
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new InputError("URL として読めません");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) throw new InputError("IP アドレスではなくドメインを入れてください");
  if (!host.includes(".")) throw new InputError("ドメインの形になっていません");
  if (/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)) throw new InputError("公開されているドメインを入れてください");
  return host;
}

export function registrableDomain(host) {
  const labels = host.split(".");
  const tld = labels.at(-1);
  const second = labels.at(-2);
  const threeLabel =
    (tld === "jp" && labels.length >= 3 && (JP_SLD.has(second) || JP_PREF.has(second))) ||
    (OTHER_SLD[tld]?.includes(second) && labels.length >= 3);
  return { domain: labels.slice(threeLabel ? -3 : -2).join("."), tld };
}

export function cloudflareRegistrar(tld) {
  if (tld === "jp") return { status: "不可", note: ".jp は Cloudflare に移管できない。ドメインは今の事業者に残し、ネームサーバーだけ Cloudflare に向ける" };
  return CLOUDFLARE_TLDS.has(tld)
    ? { status: "可", note: "ドメインごと Cloudflare に移管できる（任意）" }
    : { status: "不可", note: `.${tld} は Cloudflare の移管先の一覧（${CLOUDFLARE_TLDS_CHECKED} 時点）に無い。ネームサーバーだけ Cloudflare に向ける` };
}

// 主なメールサービスが使う DKIM のセレクタ。これ以外の名前は外から一覧できない
const DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1"];

const DNS_TYPE = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };

export async function dns(name, type) {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DNS ${type} ${name}: HTTP ${res.status}`);
  const json = await res.json();
  return (json.Answer ?? []).filter((a) => a.type === DNS_TYPE[type]).map((a) => a.data);
}

function isPrivateIp(ip) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  );
}

export async function publicIps(host) {
  const [a, aaaa] = await Promise.all([dns(host, "A"), dns(host, "AAAA")]);
  const ips = [...a, ...aaaa].filter((x) => /^[\d.]+$|:/.test(x));
  if (ips.some(isPrivateIp)) throw new Error(`${host} は私用の IP アドレスに向いているので調べない`);
  return ips;
}

function txtValue(data) {
  return data.replace(/^"|"$/g, "").replace(/"\s+"/g, "");
}

export async function readDomain(domain, tld) {
  const [ns, mxRaw, txt, dmarc, dkimFound] = await Promise.all([
    dns(domain, "NS"),
    dns(domain, "MX"),
    dns(domain, "TXT"),
    dns(`_dmarc.${domain}`, "TXT"),
    Promise.all(DKIM_SELECTORS.map(async (sel) => ((await dns(`${sel}._domainkey.${domain}`, "TXT").catch(() => [])).length ? sel : null))),
  ]);
  const nsProvider = NS_PROVIDERS.find((p) => ns.some((n) => p.match.test(n)))?.name ?? "その他";
  const mx = mxRaw
    .map((d) => {
      const [pref, host] = d.split(/\s+/);
      return { pref: Number(pref), host: (host ?? "").replace(/\.$/, "") };
    })
    .sort((x, y) => x.pref - y.pref);
  return {
    ns,
    nsProvider,
    onCloudflare: nsProvider === "Cloudflare",
    mx,
    spf: txt.map(txtValue).find((t) => t.startsWith("v=spf1")) ?? null,
    dmarc: dmarc.map(txtValue).find((t) => t.startsWith("v=DMARC1")) ?? null,
    dkim: dkimFound.filter(Boolean),
    registrar: cloudflareRegistrar(tld),
  };
}

let rdapServices = null;

async function rdapBase(tld) {
  if (!rdapServices) {
    const res = await fetch("https://data.iana.org/rdap/dns.json", { signal: AbortSignal.timeout(TIMEOUT_MS) });
    rdapServices = (await res.json()).services;
  }
  return rdapServices.find(([tlds]) => tlds.includes(tld))?.[1]?.[0] ?? null;
}

export async function readRdap(domain, tld, { userAgent } = {}) {
  if (tld === "jp") return { note: ".jp の登録情報は取りに行かない（JPRS の RDAP の窓口が IANA の一覧に無いため）" };
  try {
    const base = await rdapBase(tld);
    if (!base) return { note: `.${tld} の RDAP の窓口が IANA の一覧に無い` };
    const res = await fetch(`${base.replace(/\/?$/, "/")}domain/${domain}`, {
      headers: userAgent ? { accept: "application/rdap+json", "user-agent": userAgent } : { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { note: `登録情報を取れなかった（HTTP ${res.status}）` };
    const json = await res.json();
    const registrarEntity = (json.entities ?? []).find((e) => e.roles?.includes("registrar"));
    const fn = registrarEntity?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3] ?? null;
    const registered = (json.events ?? []).find((e) => e.eventAction === "registration")?.eventDate ?? null;
    const status = json.status ?? [];
    return {
      registrar: fn,
      registered,
      transferLocked: status.some((s) => /client transfer prohibited/i.test(s)),
    };
  } catch (e) {
    return { note: `登録情報を取れなかった（${e.message}）` };
  }
}

export async function readMail(mx, siteIps, domain) {
  if (mx.length === 0) return { kind: "none", provider: null, note: "MX の設定が無い。このドメインでメールを受けていない可能性が高い" };
  const hosts = mx.map((m) => m.host);
  const known = MAIL_PROVIDERS.find((p) => hosts.some((h) => p.match.test(h)));
  if (known) {
    const note = {
      hosted: "メールはサイトと別のサービスにある。サイトを移してもメールはそのまま",
      forwarding: "Cloudflare で転送している。受け箱は転送先にある",
      rental: "メールはレンタルサーバーにある。サーバーを解約するとメールボックスも消える",
      gateway: "メールはいったん中継サービスで受けている。受け箱がどこにあるかは外から分からない",
    }[known.kind];
    return { kind: known.kind, provider: known.name, note };
  }
  const mxIps = (await Promise.all(hosts.map((h) => dns(h, "A").catch(() => [])))).flat();
  const sameIp = mxIps.some((ip) => siteIps.includes(ip));
  const selfNamed = hosts.some((h) => h === domain || h === `mail.${domain}`);
  if (sameIp || selfNamed) {
    return {
      kind: "same_server",
      provider: null,
      note: sameIp ? "メールのサーバーがサイトと同じ IP にある。サーバーを解約するとメールも消える" : "メールのサーバーがこのドメイン自身の名前になっている。サイトと同じサーバーの可能性が高い",
    };
  }
  return { kind: "unknown", provider: null, note: "メールの置き場所を見分けられなかった。解約の前に確かめる" };
}


// DNS と登録情報だけで分かることをまとめて読む。サイトの中身は読まない
export async function checkDns(host, { userAgent } = {}) {
  let { domain, tld } = registrableDomain(host);
  const labels = host.split(".");
  if (tld === "jp" && JP_PREF.has(labels.at(-2)) && labels.length >= 4) {
    const cityLevel = labels.slice(-4).join(".");
    if ((await dns(cityLevel, "NS")).length > 0) domain = cityLevel;
  }
  const siteIps = await publicIps(host);
  const [dnsInfo, rdap] = await Promise.all([readDomain(domain, tld), readRdap(domain, tld, { userAgent })]);
  const mail = await readMail(dnsInfo.mx, siteIps, domain);
  return { host, domain, tld, dnsInfo, rdap, mail };
}
