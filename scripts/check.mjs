import { judge } from "../src/judge.js";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("使い方: npm run check -- <URL かドメイン> [...]");
  process.exit(1);
}

for (const target of targets) {
  try {
    const r = await judge(target);
    console.log(JSON.stringify({ host: r.host, verdict: r.verdict, mail: { kind: r.mail.kind, provider: r.mail.provider, mx: r.mail.mx.map((m) => m.host) }, dns: r.domainInfo.nsProvider, registrar: r.domainInfo.registrar.status, rdap: r.domainInfo.rdap, site: { wordpress: r.site.wordpress, php: r.site.php, cf: r.site.behindCloudflare, status: r.site.status }, admin: r.admin.map((a) => `${a.path} ${a.status} ${a.state}`) }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ target, error: e.message }));
  }
}
