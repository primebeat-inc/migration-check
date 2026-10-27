import { normalizeHost, checkDns, InputError } from "/lib/dns-checks.js";
import { assemble, siteFromBrowser } from "/lib/verdict.js";

const ADDRESS = "info@prime-beat.com";
const PROBE_TIMEOUT_MS = 5000;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const row = (k, v) => "<tr><th>" + esc(k) + "</th><td>" + v + "</td></tr>";
const list = (items, cls) => (items.length ? '<ul class="' + (cls || "") + '">' + items.map((i) => "<li>" + esc(i) + "</li>").join("") + "</ul>" : "<p>なし</p>");
let last = null;
let lastDns = null;
let report = { ready: false };

function resultType(r) {
  if (!r) return "none";
  if (r.verdict.alreadyMoved) return "moved";
  return r.verdict.type || "none";
}

function send(e, extra = {}) {
  try {
    navigator.sendBeacon("/api/event", new Blob([JSON.stringify({ e, t: resultType(last), ...extra })], { type: "application/json" }));
  } catch (_) {}
}

// WordPress なら必ずある画像を、利用者のブラウザが読み込めるかで見る。運営のサーバーは関わらない。
// 下の階層に置くことも多いので、よく使われる置き場所も試す
const WP_DIRS = ["", "/wp", "/wordpress", "/blog"];

function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
}

async function probeWordPress(host) {
  const results = await Promise.all(WP_DIRS.map((dir) => probeImage("https://" + host + dir + "/wp-includes/images/w-logo-blue.png")));
  if (results.includes(true)) return true;
  return results.every((x) => x === null) ? null : false;
}

function subject(r) {
  const from = new URLSearchParams(location.search).get("utm_source");
  return "サーバー引っ越しの相談（" + r.domain + "）" + (from ? "［" + from + "］" : "");
}

function consultLink(r) {
  const body = "判定: " + r.verdict.typeLabel + "\n調べた日時: " + r.checkedAt + "\n\nご相談の内容:\n";
  return "mailto:" + ADDRESS + "?subject=" + encodeURIComponent(subject(r)) + "&body=" + encodeURIComponent(body);
}

function reportSection(r) {
  const what =
    "<ul><li>PHP の版と、管理画面が外から開けるかの調べ（持ち主だと確かめたドメインだけを調べます）</li><li>今の事業者とメールの移し先ごとの、どの画面で何をするかの手引き</li><li>今の DNS の設定と、Cloudflare に入れる値の対応表、解約前の確認表、うまくいかなかったときの戻し方</li></ul>";
  if (r.site.source !== "browser" || !r.verdict.consult) return "";
  if (!report.ready) {
    return "<h2>サーバー引っ越しの手順書（税込980円・買い切り）</h2>" + what + '<p class="note">準備中です。決済の準備ができしだい始めます。</p>';
  }
  return (
    "<h2>サーバー引っ越しの手順書（税込980円・買い切り）</h2>" +
    what +
    '<p>はじめに、このドメインの持ち主だと確かめます。DNS に確認の値を1行足してもらいます。</p><div class="actions"><button id="owner-start" type="button">持ち主の確認をはじめる</button></div><div id="owner" aria-live="polite"></div>'
  );
}

function render(r) {
  const v = r.verdict, d = r.domainInfo, m = r.mail, s = r.site;
  const mailMove = v.mailMove === true ? "要る" : v.mailMove === false ? "要らない" : "確かめが要る";
  const rdap = d.rdap.note
    ? esc(d.rdap.note)
    : esc(d.rdap.registrar || "不明") + (d.rdap.registered ? "（登録 " + esc(d.rdap.registered.slice(0, 10)) + "）" : "") + (d.rdap.transferLocked ? "、移管のロックあり" : "");
  const kind = s.platform
    ? s.platform + "（サイト作成サービス）"
    : s.cms || (s.dynamicHints && s.dynamicHints.length ? "サーバーで動くプログラムがある（" + s.dynamicHints.join("、") + "）" : s.source === "browser" ? "確かめていない" : "目印なし");
  const detail = s.source === "browser"
    ? row("PHP の版・管理画面", "無料の判定では調べていません（手順書で、持ち主の確認のあとに調べます）")
    : (s.reachable ? row("サーバーのソフト", esc([s.server, s.poweredBy].filter(Boolean).join(" / ") || "なし")) : "") + r.admin.map((a) => row("管理画面 " + a.path, esc(a.state))).join("");
  return [
    "<h2>判定</h2>",
    '<p class="verdict">' + esc(v.typeLabel) + "</p>",
    "<table>",
    row("ドメイン", esc(r.domain) + "<br>" + esc(v.domainAction || "")),
    row("メールの引っ越し", esc(mailMove)),
    "</table>",
    "<h2>気をつける点</h2>",
    list(v.warnings || [], "warn"),
    "<h2>持ち主がやる手順</h2>",
    v.steps.length ? "<ol>" + v.steps.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol>" : "<p>やることはありません</p>",
    v.consult
      ? '<h2>引っ越しを頼むとき</h2><p>この結果を添えて、メールでご相談ください。サイトの作りとメールの状態を確かめてから、見積をお出しします。</p><p>宛先: <strong>' +
        ADDRESS +
        "</strong>　件名の例: " +
        esc(subject(r)) +
        '</p><div class="actions"><a id="mail" href="' +
        esc(consultLink(r)) +
        '">メールのアプリで書く</a><button id="copy" type="button" class="plain">宛先と件名をコピー</button><span id="copied" class="note" aria-live="polite"></span></div>'
      : "",
    reportSection(r),
    "<h2>読み取ったこと</h2>",
    "<table>",
    row("DNS の置き場所", esc(d.nsProvider) + '<br><span class="note">' + esc(d.ns.join(", ")) + "</span>"),
    row("登録事業者", rdap),
    row("メールの置き場所", esc(m.provider || "") + (m.provider ? "<br>" : "") + esc(m.note) + '<br><span class="note">MX: ' + esc(m.mx.map((x) => x.host).join(", ") || "なし") + "</span>"),
    row("SPF", m.spf ? "<code>" + esc(m.spf) + "</code>" : "なし"),
    row("DKIM", d.dkim && d.dkim.length ? "あり（" + esc(d.dkim.join("、")) + "）" : "よく使われる設定では見つからない"),
    row("DMARC", m.dmarc ? "<code>" + esc(m.dmarc) + "</code>" : "なし"),
    s.reachable ? row("サイトの作り", esc(kind) + (s.wordpressSignals && s.wordpressSignals.length ? '<br><span class="note">' + esc(s.wordpressSignals.join("、")) + "</span>" : "")) : row("サイト", '<span class="error">' + esc(s.error) + "</span>"),
    s.reachable ? row("Cloudflare を通っているか", s.behindCloudflare ? "はい" : "いいえ") : "",
    detail,
    "</table>",
    '<p class="note">調べた日時: ' +
      esc(r.checkedAt) +
      (s.source === "browser" ? "。この判定はすべてこのブラウザの中で行い、Prime Beat のサーバーには何も送っていません（件数を除く）。" : "。持ち主の確認のあと、サイトの中身を Prime Beat のサーバーで調べました。") +
      "</p>",
  ].join("");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {}
  // クリップボードの API が使えない環境向けの予備
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "absolute";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_) {}
  area.remove();
  return ok;
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "うまくいきませんでした（HTTP " + res.status + "）");
  return body;
}

function wireOwner(r) {
  const start = document.getElementById("owner-start");
  if (!start) return;
  start.addEventListener("click", async () => {
    const box = document.getElementById("owner");
    start.disabled = true;
    try {
      const c = await getJson("/api/owner/challenge?host=" + encodeURIComponent(r.host));
      box.innerHTML =
        "<p>ドメインの DNS に、次の TXT を1行足してください。足したら、数分おいて「確かめる」を押してください。</p><table>" +
        row("名前", "<code>" + esc(c.name) + "</code>") +
        row("値", "<code>" + esc(c.value) + "</code>") +
        '</table><div class="actions"><button id="owner-verify" type="button">確かめる</button><span id="owner-msg" class="note" aria-live="polite"></span></div>';
      document.getElementById("owner-verify").addEventListener("click", () => verifyOwner(r));
    } catch (err) {
      box.innerHTML = '<p class="error">' + esc(err.message) + "</p>";
      start.disabled = false;
    }
  });
}

async function verifyOwner(r) {
  const msg = document.getElementById("owner-msg");
  const button = document.getElementById("owner-verify");
  button.disabled = true;
  msg.textContent = "確かめています";
  try {
    const v = await getJson("/api/owner/verify?host=" + encodeURIComponent(r.host));
    if (!v.verified) {
      msg.textContent = v.error;
      button.disabled = false;
      return;
    }
    msg.textContent = "持ち主だと確かめました。サイトの中身を調べています";
    const sitePart = await getJson("/api/site?host=" + encodeURIComponent(r.host) + "&proof=" + encodeURIComponent(v.proof));
    const detailed = assemble(r.host, lastDns, sitePart);
    last = detailed;
    document.getElementById("out").innerHTML = render(detailed);
    wire(detailed);
  } catch (err) {
    msg.textContent = err.message;
    button.disabled = false;
  }
}

function wire(r) {
  const mail = document.getElementById("mail");
  if (mail) mail.addEventListener("click", () => send("consult_mail"));
  const copy = document.getElementById("copy");
  if (copy)
    copy.addEventListener("click", async () => {
      const ok = await copyText("宛先: " + ADDRESS + "\n件名: " + subject(r));
      document.getElementById("copied").textContent = ok ? "コピーしました" : "コピーできませんでした。宛先を選んでコピーしてください";
      send("consult_copy");
    });
  wireOwner(r);
}

document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.getElementById("out"), b = document.getElementById("b");
  let host;
  try {
    host = normalizeHost(document.getElementById("u").value);
  } catch (err) {
    out.innerHTML = '<p class="error">' + esc(err instanceof InputError ? err.message : "URL として読めません") + "</p>";
    return;
  }
  b.disabled = true;
  out.innerHTML = '<p class="note">調べています（10秒ほど）</p>';
  try {
    const dnsPart = await checkDns(host);
    const wordpress = dnsPart.hosting.hasAddress && !dnsPart.hosting.platform ? await probeWordPress(host) : null;
    const r = assemble(host, dnsPart, { site: siteFromBrowser(host, dnsPart.hosting, wordpress), admin: [] });
    lastDns = dnsPart;
    last = r;
    out.innerHTML = render(r);
    wire(r);
    send("check", { m: r.verdict.mailMove === true });
  } catch (err) {
    out.innerHTML = '<p class="error">' + esc(err.message) + "</p>";
  } finally {
    b.disabled = false;
  }
});

fetch("/api/report/status")
  .then((res) => res.json())
  .then((s) => {
    report = s;
  })
  .catch(() => {});

fetch("/api/version")
  .then((res) => res.json())
  .then(({ commit }) => {
    const el = document.getElementById("commit");
    if (!commit) {
      el.textContent = "不明（手元で動かしている版）";
      return;
    }
    el.innerHTML = '<a href="https://github.com/primebeat-inc/migration-check/tree/' + esc(commit) + '" rel="noopener">' + esc(commit.slice(0, 7)) + "</a>";
  })
  .catch(() => {});
