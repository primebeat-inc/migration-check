import { normalizeHost, checkDns, InputError } from "/lib/dns-checks.js";
import { assemble } from "/lib/verdict.js";

const ADDRESS = "info@prime-beat.com";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const row = (k, v) => "<tr><th>" + esc(k) + "</th><td>" + v + "</td></tr>";
const list = (items, cls) => (items.length ? '<ul class="' + (cls || "") + '">' + items.map((i) => "<li>" + esc(i) + "</li>").join("") + "</ul>" : "<p>なし</p>");
let last = null;

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

function subject(r) {
  const from = new URLSearchParams(location.search).get("utm_source");
  return "サイトとメールの引っ越しの相談（" + r.domain + "）" + (from ? "［" + from + "］" : "");
}

function consultLink(r) {
  const body = "判定: " + r.verdict.typeLabel + "\n調べた日時: " + r.checkedAt + "\n\nご相談の内容:\n";
  return "mailto:" + ADDRESS + "?subject=" + encodeURIComponent(subject(r)) + "&body=" + encodeURIComponent(body);
}

function render(r) {
  const v = r.verdict, d = r.domainInfo, m = r.mail, s = r.site;
  const mailMove = v.mailMove === true ? "要る" : v.mailMove === false ? "要らない" : "確かめが要る";
  const rdap = d.rdap.note
    ? esc(d.rdap.note)
    : esc(d.rdap.registrar || "不明") + (d.rdap.registered ? "（登録 " + esc(d.rdap.registered.slice(0, 10)) + "）" : "") + (d.rdap.transferLocked ? "、移管のロックあり" : "");
  const kind = s.platform
    ? s.platform + "（サイト作成サービス）"
    : s.cms || (s.dynamicHints && s.dynamicHints.length ? "サーバーで動くプログラムがある（" + s.dynamicHints.join("、") + "）" : "目印なし");
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
    "<h2>読み取ったこと</h2>",
    "<table>",
    row("DNS の置き場所", esc(d.nsProvider) + '<br><span class="note">' + esc(d.ns.join(", ")) + "</span>"),
    row("登録事業者", rdap),
    row("メールの置き場所", esc(m.provider || "") + (m.provider ? "<br>" : "") + esc(m.note) + '<br><span class="note">MX: ' + esc(m.mx.map((x) => x.host).join(", ") || "なし") + "</span>"),
    row("SPF", m.spf ? "<code>" + esc(m.spf) + "</code>" : "なし"),
    row("DKIM", d.dkim && d.dkim.length ? "あり（" + esc(d.dkim.join("、")) + "）" : "よく使われる設定では見つからない"),
    row("DMARC", m.dmarc ? "<code>" + esc(m.dmarc) + "</code>" : "なし"),
    row("サイト", s.reachable ? esc(s.finalUrl) + "（HTTP " + esc(s.status) + "）" : '<span class="error">' + esc(s.error) + "</span>"),
    s.reachable ? row("サイトの作り", esc(kind) + (s.wordpress ? '<br><span class="note">' + esc(s.wordpressSignals.join("、")) + "</span>" : "")) : "",
    s.reachable ? row("サーバーのソフト", esc([s.server, s.poweredBy].filter(Boolean).join(" / ") || "なし")) : "",
    s.reachable ? row("Cloudflare を通っているか", s.behindCloudflare ? "はい" : "いいえ") : "",
    r.admin.map((a) => row("管理画面 " + a.path, esc(a.state))).join(""),
    "</table>",
    '<p class="note">調べた日時: ' + esc(r.checkedAt) + "。DNS とメールの判定はこのブラウザの中で行い、サイトの中身だけを Prime Beat のサーバーで調べました。</p>",
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
}

async function checkSiteOnServer(host) {
  const res = await fetch("/api/site?host=" + encodeURIComponent(host));
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "サイトの中身を調べられませんでした（HTTP " + res.status + "）");
  return body;
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
    const [dnsPart, sitePart] = await Promise.all([checkDns(host), checkSiteOnServer(host)]);
    const r = assemble(host, dnsPart, sitePart);
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
