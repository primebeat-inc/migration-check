import { normalizeHost, publicIps } from "../public/lib/dns-checks.js";

// サイトの中身はブラウザから読めない（CORS）ので、ここだけサーバーで読む
const UA = "PrimeBeat-migration-check/0.4 (beta; +https://github.com/primebeat-inc/migration-check)";
const TIMEOUT_MS = 8000;
const MAX_BODY = 200_000;
const MAX_REDIRECTS = 3;

const generator = (body, re) => new RegExp(`<meta[^>]+name=["']generator["'][^>]+${re}`, "i").test(body);

// サイト作成サービスはネームサーバーを変えられないことが多く、移行の対象から外す
const PLATFORMS = [
  { name: "Wix", test: (b, h) => Boolean(h.get("x-wix-request-id")) || /static\.wixstatic\.com/.test(b) },
  { name: "Shopify", test: (b, h) => Boolean(h.get("x-shopid")) || /cdn\.shopify\.com/.test(b) },
  { name: "STUDIO", test: (b) => generator(b, "STUDIO") || /studio\.design/.test(b) },
  { name: "Jimdo", test: (b) => /jimstatic\.com|jimdo(site|free)?\.com/.test(b) },
  { name: "Squarespace", test: (b, h) => /squarespace/i.test(h.get("server") ?? "") || /static1\.squarespace\.com/.test(b) },
  { name: "ペライチ", test: (b) => /peraichi\.com/.test(b) },
  { name: "BASE", test: (b) => /baseec-img|thebase\.in/.test(b) },
  { name: "Webflow", test: (b) => generator(b, "Webflow") || /assets\.website-files\.com|cdn\.prod\.website-files\.com/.test(b) },
];

const OTHER_CMS = [
  { name: "Movable Type", test: (b) => generator(b, "Movable Type") || /\/mt-static\//.test(b) },
  { name: "EC-CUBE", test: (b, h) => /eccube/i.test(h.get("set-cookie") ?? "") || /["'(]\/html\/(template|user_data)\//.test(b) },
  { name: "Drupal", test: (b, h) => generator(b, "Drupal") || Boolean(h.get("x-drupal-cache")) },
  { name: "Joomla", test: (b) => generator(b, "Joomla") },
];

const ADMIN_PATHS_WP = ["/wp-login.php", "/wp-admin/"];
const ADMIN_PATHS_OTHER = ["/administrator/", "/admin/"];

// redirect: "follow" にしないのは、公開の名前から手元や社内の IP へ飛ばされるのを1回ずつ止めるため
async function safeGet(url) {
  let current = new URL(url);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    normalizeHost(current.hostname);
    await publicIps(current.hostname);
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current);
      continue;
    }
    const body = (await res.text()).slice(0, MAX_BODY);
    return { url: current.toString(), status: res.status, headers: res.headers, body };
  }
  throw new Error(`リダイレクトが ${MAX_REDIRECTS} 回を超えた`);
}

async function readSite(host) {
  let page;
  try {
    page = await safeGet(`https://${host}/`);
  } catch (httpsError) {
    try {
      page = await safeGet(`http://${host}/`);
    } catch {
      return { reachable: false, error: httpsError.message };
    }
  }
  const h = page.headers;
  const server = h.get("server");
  const poweredBy = h.get("x-powered-by");
  const link = h.get("link") ?? "";
  const signals = [];
  if (/\/wp-content\//.test(page.body)) signals.push("/wp-content/ が HTML にある");
  if (/\/wp-includes\//.test(page.body)) signals.push("/wp-includes/ が HTML にある");
  if (/<meta[^>]+name=["']generator["'][^>]+WordPress/i.test(page.body)) signals.push("generator が WordPress");
  if (/api\.w\.org/.test(link)) signals.push("Link ヘッダーに api.w.org");
  if (h.get("x-pingback")) signals.push("X-Pingback ヘッダーがある");
  const php = `${poweredBy ?? ""} ${server ?? ""}`.match(/PHP\/([\d.]+)/i)?.[1] ?? null;
  // ボット対策の確認画面は突破しない。読めなかったと返す
  const challenged = h.get("cf-mitigated") === "challenge" || ([403, 503].includes(page.status) && /challenges\.cloudflare\.com|<title>Just a moment/i.test(page.body));
  if (challenged || page.status >= 400) {
    return {
      reachable: true,
      readable: false,
      unreadableReason: challenged ? "Cloudflare のボット対策の確認画面が出て、サイトの中身を読めなかった" : `サイトがエラーを返した（HTTP ${page.status}）`,
      finalUrl: page.url,
      status: page.status,
      server,
      poweredBy,
      php,
      wordpress: false,
      wordpressSignals: [],
      cms: null,
      platform: null,
      dynamicHints: [],
      behindCloudflare: Boolean(h.get("cf-ray")) || /cloudflare/i.test(server ?? ""),
    };
  }
  const platform = PLATFORMS.find((p) => p.test(page.body, h))?.name ?? null;
  const cookies = h.get("set-cookie") ?? "";
  const dynamicHints = [];
  if (php) dynamicHints.push(`PHP ${php}`);
  else if (/php/i.test(poweredBy ?? "")) dynamicHints.push("PHP");
  if (poweredBy && !/php/i.test(poweredBy)) dynamicHints.push(poweredBy);
  if (/PHPSESSID|laravel_session|JSESSIONID|ASP\.NET_SessionId|connect\.sid/i.test(cookies)) dynamicHints.push("セッションの Cookie");
  if (/href=["'][^"']+\.(php|cgi|aspx?)(\?|#|["'])/i.test(page.body)) dynamicHints.push(".php などへのリンク");
  const cms = signals.length > 0 ? "WordPress" : (OTHER_CMS.find((c) => c.test(page.body, h))?.name ?? null);
  return {
    reachable: true,
    readable: true,
    finalUrl: page.url,
    status: page.status,
    server,
    poweredBy,
    php,
    wordpress: signals.length > 0,
    wordpressSignals: signals,
    cms,
    platform,
    dynamicHints,
    behindCloudflare: Boolean(h.get("cf-ray")) || /cloudflare/i.test(server ?? ""),
  };
}

async function readAdmin(host, wordpress) {
  const paths = wordpress ? [...ADMIN_PATHS_WP, ...ADMIN_PATHS_OTHER] : ADMIN_PATHS_OTHER;
  const results = [];
  for (const path of paths) {
    try {
      const page = await safeGet(`https://${host}${path}`);
      const finalUrl = new URL(page.url);
      const finalHost = finalUrl.hostname;
      const earlier = results.find((r) => r.exposed && r.finalPath === finalUrl.pathname);
      if (earlier) {
        results.push({ path, status: page.status, finalUrl: page.url, finalPath: finalUrl.pathname, exposed: false, state: `${earlier.path} と同じログイン画面に飛ぶ` });
        continue;
      }
      const behindAccess = /cloudflareaccess\.com$/.test(finalHost);
      const hasPassword = /type\s*=\s*["']?password/i.test(page.body);
      let state;
      if (behindAccess) state = "Cloudflare Access の後ろ";
      else if (page.status === 401) state = "Basic 認証あり";
      else if (page.status === 200 && hasPassword) state = "公開（ログイン画面が開く）";
      else state = "見つからない";
      results.push({ path, status: page.status, finalUrl: page.url, finalPath: finalUrl.pathname, exposed: state.startsWith("公開"), state });
    } catch (e) {
      results.push({ path, status: null, exposed: false, state: `調べられなかった（${e.message}）` });
    }
  }
  return results;
}


export async function checkSite(host) {
  normalizeHost(host);
  const site = await readSite(host);
  const admin = site.reachable ? await readAdmin(host, site.wordpress) : [];
  return { site, admin };
}
