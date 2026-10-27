import { normalizeHost, registrableDomain, InputError } from "../public/lib/dns-checks.js";
import { challenge, isOwnerVerified, issueProof, isProofValid } from "./owner.js";
import { checkSite } from "./site-checks.js";
import { clientKey } from "./client-key.js";
import { CLIENT_EVENTS, RESULT_TYPES } from "./stats.js";

export { ClientLimiter } from "./limiter.js";
export { Stats } from "./stats.js";

// 画面のファイルは public/ から静的に配る。この Worker が受けるのは /api/ だけ。
// 無料の判定はブラウザだけで動き、ここには届かない。サイトの中身は持ち主を確かめたドメインだけを調べる
const CACHE_SECONDS = 600;
const STATS_DAYS = 31;
const REPOSITORY = "https://github.com/primebeat-inc/migration-check";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...extra },
  });
}

function stats(env) {
  return env.STATS.get(env.STATS.idFromName("global"));
}

function count(env, ctx, name) {
  ctx.waitUntil(stats(env).add(name).catch(() => {}));
}

async function allow(env, key) {
  return env.CLIENT_LIMITER.get(env.CLIENT_LIMITER.idFromName(key)).hit();
}

function paymentRequired(env) {
  return env.PAYMENT_REQUIRED !== "false";
}

function reportReady(env) {
  return Boolean(env.OWNER_SECRET) && (!paymentRequired(env) || Boolean(env.STRIPE_SECRET_KEY));
}

async function limited(request, env, ctx) {
  const { allowed, retryAfter } = await allow(env, clientKey(request.headers.get("cf-connecting-ip")));
  if (allowed) return null;
  count(env, ctx, "ratelimited");
  return json({ error: `回数が多すぎます。${retryAfter}秒ほど待ってからもう一度試してください` }, 429, { "retry-after": String(retryAfter) });
}

function domainOf(url) {
  return registrableDomain(normalizeHost(url.searchParams.get("host"))).domain;
}

async function ownerChallenge(request, env, ctx, url) {
  if (!reportReady(env)) return json({ error: "手順書は準備中です" }, 503);
  const stop = await limited(request, env, ctx);
  if (stop) return stop;
  let domain;
  try {
    domain = domainOf(url);
  } catch (e) {
    return json({ error: e.message }, 400);
  }
  count(env, ctx, "owner_challenge");
  return json({ domain, ...(await challenge(env.OWNER_SECRET, domain)) });
}

async function ownerVerify(request, env, ctx, url) {
  if (!reportReady(env)) return json({ error: "手順書は準備中です" }, 503);
  const stop = await limited(request, env, ctx);
  if (stop) return stop;
  let domain;
  try {
    domain = domainOf(url);
  } catch (e) {
    return json({ error: e.message }, 400);
  }
  if (!(await isOwnerVerified(env.OWNER_SECRET, domain))) {
    return json({ verified: false, error: "DNS に確認の値がまだ見つかりません。追加してから数分おいて、もう一度試してください" }, 200);
  }
  count(env, ctx, "owner_verified");
  return json({ verified: true, domain, proof: await issueProof(env.OWNER_SECRET, domain) });
}

async function site(request, env, ctx, url) {
  const started = Date.now();
  if (!reportReady(env)) return json({ error: "手順書は準備中です" }, 503);
  const stop = await limited(request, env, ctx);
  if (stop) return stop;

  let host;
  try {
    host = normalizeHost(url.searchParams.get("host"));
  } catch (e) {
    return json({ error: e.message }, 400);
  }
  // 持ち主の同意が無いサイトは調べない。調べた記録が相手に残るため
  const domain = registrableDomain(host).domain;
  if (!(await isProofValid(env.OWNER_SECRET, domain, url.searchParams.get("proof")))) {
    return json({ error: "持ち主の確認が済んでいないか、確認から1時間を過ぎました" }, 403);
  }
  if (paymentRequired(env)) return json({ error: "決済の確認は準備中です" }, 402);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.migration-check.internal/site/${host}`);
  const cached = await cache.match(cacheKey);
  if (cached) return json(await cached.json(), 200, { "x-result-cache": "hit" });

  if (!(await env.PER_TARGET.limit({ key: host })).success) {
    return json({ error: "このドメインはいま続けて調べられています。1分ほど待ってからもう一度試してください" }, 429, { "retry-after": "60" });
  }

  try {
    const result = await checkSite(host);
    ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(result), { headers: { "cache-control": `max-age=${CACHE_SECONDS}` } })));
    count(env, ctx, "detail_checked");
    console.log(JSON.stringify({ event: "site", readable: result.site.readable ?? false, ms: Date.now() - started }));
    return json(result);
  } catch (e) {
    count(env, ctx, "check_error");
    return json({ error: e.message }, e instanceof InputError ? 400 : 502);
  }
}

async function event(request, env, ctx) {
  // 押された数を水増しされないよう、判定とは別の枠で接続元ごとに回数を絞る
  const { allowed } = await allow(env, `event:${clientKey(request.headers.get("cf-connecting-ip"))}`);
  if (!allowed) return new Response(null, { status: 204 });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON を送ってください" }, 400);
  }
  if (!RESULT_TYPES.includes(body?.t)) return json({ error: "受け付けない値です" }, 400);
  if (body.e === "check") {
    count(env, ctx, body.t === "none" ? "check_unreadable" : `check_${body.t}`);
    if (body.m === true) count(env, ctx, "check_mail_move");
    return new Response(null, { status: 204 });
  }
  if (!CLIENT_EVENTS.includes(body.e)) return json({ error: "受け付けない値です" }, 400);
  count(env, ctx, body.e);
  count(env, ctx, `${body.e}_${body.t}`);
  return new Response(null, { status: 204 });
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

async function statsSummary(request, env) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!env.STATS_TOKEN || !token || !(await sameSecret(token, env.STATS_TOKEN))) {
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }
  return json({ days: STATS_DAYS, rows: await stats(env).summary(STATS_DAYS) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/event") return event(request, env, ctx);
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "この方法は受け付けません" }, 405, { allow: "GET, HEAD" });
    switch (url.pathname) {
      case "/api/site":
        return site(request, env, ctx, url);
      case "/api/report/status":
        return json({ ready: reportReady(env), priceYen: 980, taxIncluded: true });
      case "/api/owner/challenge":
        return ownerChallenge(request, env, ctx, url);
      case "/api/owner/verify":
        return ownerVerify(request, env, ctx, url);
      case "/api/version":
        return json({ commit: env.COMMIT || null, repository: REPOSITORY });
      case "/api/stats":
        return statsSummary(request, env);
      default:
        return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    }
  },
};
