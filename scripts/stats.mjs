import { readFileSync } from "node:fs";

// 合言葉は git に入れないファイルに置く。公開先は .stats-token、手元の wrangler dev は .dev.vars
const local = process.argv.includes("--local");
const base = process.env.STATS_URL ?? (local ? "http://localhost:8790" : "https://check.prime-beat.com");
const token = local
  ? readFileSync(".dev.vars", "utf8").match(/^STATS_TOKEN=(.+)$/m)?.[1]
  : readFileSync(".stats-token", "utf8").trim();

const res = await fetch(`${base}/api/stats`, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`集計を取れませんでした（HTTP ${res.status}）`);
  process.exit(1);
}
const { days, rows } = await res.json();
const total = {};
for (const { event, n } of rows) total[event] = (total[event] ?? 0) + n;
const checks = Object.entries(total).filter(([e]) => /^check_(A|B|C|D|moved|unreadable)$/.test(e)).reduce((a, [, n]) => a + n, 0);
const consults = (total.consult_mail ?? 0) + (total.consult_copy ?? 0);
console.log(`直近${days}日の合計`);
for (const [event, n] of Object.entries(total).sort()) console.log(`  ${event.padEnd(22)} ${n}`);
console.log(`判定 ${checks} 件のうち、相談のリンクが押されたのは ${consults} 件${checks ? `（${((consults / checks) * 100).toFixed(1)}%）` : ""}`);
console.log("\n日ごと");
for (const { day, event, n } of rows) console.log(`  ${day} ${event.padEnd(22)} ${n}`);
