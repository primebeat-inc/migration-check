import { DurableObject } from "cloudflare:workers";

export const CHECK_EVENTS = ["check_A", "check_B", "check_C", "check_D", "check_moved", "check_unreadable", "check_mail_move", "check_error", "ratelimited"];
export const CLIENT_EVENTS = ["consult_mail", "consult_copy"];
export const RESULT_TYPES = ["A", "B", "C", "D", "moved", "none"];

// 日ごとの件数だけを持つ。ドメインと接続元は書かない
export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, event TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, event))");
  }

  add(event) {
    const day = new Date().toISOString().slice(0, 10);
    this.ctx.storage.sql.exec(
      "INSERT INTO counts (day, event, n) VALUES (?, ?, 1) ON CONFLICT (day, event) DO UPDATE SET n = n + 1",
      day,
      event,
    );
  }

  summary(days) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    return this.ctx.storage.sql.exec("SELECT day, event, n FROM counts WHERE day >= ? ORDER BY day, event", since).toArray();
  }
}
