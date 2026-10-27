import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// 公開先が配っている画面のファイルが、画面に出ている版のリポジトリのファイルと同じかを確かめる
const base = (process.argv[2] ?? "https://check.prime-beat.com").replace(/\/$/, "");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const { commit } = await (await fetch(`${base}/api/version`)).json();
if (!commit) {
  console.error("公開先が版を名乗っていません");
  process.exit(1);
}
try {
  execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`]);
} catch {
  console.error(`手元に ${commit.slice(0, 7)} がありません。git fetch してからもう一度試してください`);
  process.exit(1);
}

const files = execFileSync("git", ["ls-tree", "-r", "--name-only", commit, "public"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.endsWith("/_headers"));

let mismatches = 0;
console.log(`公開先 ${base} の版 ${commit.slice(0, 7)} と見比べます`);
for (const file of files) {
  const rel = file.replace(/^public\//, "");
  const path = rel === "index.html" ? "/" : rel === "terms.html" ? "/terms" : `/${rel}`;
  const expected = sha(execFileSync("git", ["show", `${commit}:${file}`]));
  const actual = sha(Buffer.from(await (await fetch(`${base}${path}`, { cache: "no-store" })).arrayBuffer()));
  const same = expected === actual;
  if (!same) mismatches++;
  console.log(`  ${same ? "同じ  " : "違う  "} ${path}`);
}
console.log(mismatches ? `${mismatches} 件が違います` : "すべて同じです");
process.exit(mismatches ? 1 : 0);
