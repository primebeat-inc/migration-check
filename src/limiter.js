import { DurableObject } from "cloudflare:workers";

export const CLIENT_LIMIT = 10;
export const CLIENT_WINDOW_MS = 60_000;

// 回数はメモリにだけ持つ。ストレージに書かないのは、書き込みの行数で料金と無料枠を使わないため。
// 60秒より長く呼ばれないと消えることがあるが、そのときは窓の外なので数え直しても結果は同じ
export class ClientLimiter extends DurableObject {
  hits = [];

  hit() {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < CLIENT_WINDOW_MS);
    if (this.hits.length >= CLIENT_LIMIT) {
      return { allowed: false, retryAfter: Math.ceil((CLIENT_WINDOW_MS - (now - this.hits[0])) / 1000) };
    }
    this.hits.push(now);
    return { allowed: true, retryAfter: 0 };
  }
}
