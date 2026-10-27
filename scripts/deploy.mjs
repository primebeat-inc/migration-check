import { execFileSync, spawnSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// 画面に出す版が GitHub で見られるよう、綺麗な作業ツリーで、push 済みのコミットだけをデプロイする
if (git("status", "--porcelain")) {
  console.error("コミットしていない変更があります。コミットしてからデプロイしてください");
  process.exit(1);
}
const commit = git("rev-parse", "HEAD");
if (!git("branch", "-r", "--contains", commit)) {
  console.error(`${commit.slice(0, 7)} はまだ GitHub に push されていません`);
  process.exit(1);
}
for (const [cmd, args] of [["npm", ["test"]], ["npx", ["wrangler", "deploy", "--var", `COMMIT:${commit}`]]]) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
