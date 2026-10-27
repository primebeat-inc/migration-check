import { normalizeHost, checkDns } from "../public/lib/dns-checks.js";
import { assemble } from "../public/lib/verdict.js";
import { checkSite } from "./site-checks.js";

export { InputError, normalizeHost, registrableDomain, cloudflareRegistrar } from "../public/lib/dns-checks.js";
export { verdict, assemble } from "../public/lib/verdict.js";

export const SERVER_UA = "PrimeBeat-migration-check/0.4 (beta; +https://github.com/primebeat-inc/migration-check)";

// 画面と同じ判定を1か所で通しで行う。手元のコマンドとテストが使う
export async function judge(input, { userAgent = SERVER_UA } = {}) {
  const host = normalizeHost(input);
  const [dnsPart, sitePart] = await Promise.all([checkDns(host, { userAgent }), checkSite(host)]);
  return assemble(String(input), dnsPart, sitePart);
}
