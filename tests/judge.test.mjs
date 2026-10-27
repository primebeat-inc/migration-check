import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHost, registrableDomain, cloudflareRegistrar, verdict, InputError } from "../src/judge.js";

function situation(overrides = {}) {
  const base = {
    domain: "example.co.jp",
    tld: "jp",
    dnsInfo: { onCloudflare: false, nsProvider: "お名前.com", dmarc: "v=DMARC1; p=none", registrar: cloudflareRegistrar("jp") },
    rdap: {},
    mail: { kind: "hosted" },
    site: { reachable: true, readable: true, platform: null, cms: null, dynamicHints: [], behindCloudflare: false, php: null },
    admin: [],
  };
  return {
    ...base,
    ...overrides,
    dnsInfo: { ...base.dnsInfo, ...overrides.dnsInfo },
    mail: { ...base.mail, ...overrides.mail },
    site: { ...base.site, ...overrides.site },
  };
}

test("目印の無いサイトは型A で、相談の導線を出し、価格は出さない", () => {
  const v = verdict(situation());
  assert.equal(v.type, "A");
  assert.equal(v.consult, true);
  assert.doesNotMatch(JSON.stringify(v), /円/);
});

test("サーバーで動くプログラムの目印があると型A にせず、確かめが要ると出す", () => {
  const v = verdict(situation({ site: { dynamicHints: ["PHP 8.3.36"], php: "8.3.36" } }));
  assert.equal(v.type, "D");
  assert.match(v.typeLabel, /型を確かめる必要がある/);
  assert.equal(v.consult, true);
});

test("CMS があれば型B", () => {
  const v = verdict(situation({ site: { cms: "WordPress", wordpress: true } }));
  assert.equal(v.type, "B");
  assert.equal(v.typeLabel, "型B: WordPress");
});

test("EC-CUBE は静的にできないと手順に書く", () => {
  const v = verdict(situation({ site: { cms: "EC-CUBE" } }));
  assert.ok(v.steps.some((s) => s.includes("EC サイトは静的にできない")));
});

test("サイト作成サービスは型C で、メールの引っ越しが無ければ相談の導線を出さない", () => {
  const v = verdict(situation({ site: { platform: "Shopify" } }));
  assert.equal(v.type, "C");
  assert.equal(v.consult, false);
});

test("サイト作成サービスでも、メールがレンタルサーバーにあれば相談の導線を出す", () => {
  const v = verdict(situation({ site: { platform: "Wix" }, mail: { kind: "rental" } }));
  assert.equal(v.mailMove, true);
  assert.equal(v.consult, true);
});

test("中身を読めないサイトは型を決めず、理由を出す", () => {
  const v = verdict(situation({ site: { readable: false, unreadableReason: "Cloudflare のボット対策の確認画面が出て、サイトの中身を読めなかった" } }));
  assert.equal(v.type, null);
  assert.match(v.typeLabel, /型を判定できない: Cloudflare のボット対策/);
  assert.equal(v.consult, false);
});

test("届かないサイトは判定できないと出す", () => {
  const v = verdict(situation({ site: { reachable: false, error: "timeout" } }));
  assert.equal(v.type, null);
  assert.equal(v.typeLabel, "サイトに届かず判定できない");
});

test("DNS もサイトもすでに Cloudflare なら、移ったと出して相談の導線を出さない", () => {
  const v = verdict(situation({ dnsInfo: { onCloudflare: true }, site: { behindCloudflare: true } }));
  assert.equal(v.alreadyMoved, true);
  assert.match(v.typeLabel, /すでに Cloudflare に移っている/);
  assert.equal(v.consult, false);
  assert.deepEqual(v.steps, []);
});

test("メールの受け口が中継サービスなら、引っ越しは確かめが要る", () => {
  assert.equal(verdict(situation({ mail: { kind: "gateway" } })).mailMove, null);
});

test("PHP の版を JPCERT-AT-2026-0033 の修正版と比べる", () => {
  const older = verdict(situation({ site: { php: "8.3.35", dynamicHints: ["PHP 8.3.35"] } }));
  const fixed = verdict(situation({ site: { php: "8.3.36", dynamicHints: ["PHP 8.3.36"] } }));
  const otherBranch = verdict(situation({ site: { php: "8.2.20", dynamicHints: ["PHP 8.2.20"] } }));
  assert.ok(older.warnings.some((w) => w.includes("より古い")));
  assert.ok(fixed.warnings.some((w) => w.includes("以上")));
  assert.ok(otherBranch.warnings.some((w) => w.includes("対象かを確かめる")));
});

test(".jp は移管できず、.com はでき、一覧に無い国別ドメインはできない", () => {
  assert.equal(cloudflareRegistrar("jp").status, "不可");
  assert.equal(cloudflareRegistrar("com").status, "可");
  assert.equal(cloudflareRegistrar("de").status, "不可");
});

test("移管できる .com では任意の移管の手順を出し、すでに Cloudflare で登録済みなら出さない", () => {
  const com = { domain: "example.com", tld: "com", dnsInfo: { registrar: cloudflareRegistrar("com") } };
  assert.ok(verdict(situation(com)).steps.some((s) => s.startsWith("（任意）ドメインも移すなら")));
  const registered = verdict({ ...situation(com), rdap: { registrar: "Cloudflare, Inc." } });
  assert.ok(!registered.steps.some((s) => s.startsWith("（任意）")));
});

test("URL の形を受け付け、手元や社内を指す入力は断る", () => {
  assert.equal(normalizeHost("https://www.Example.co.jp/path?q=1"), "www.example.co.jp");
  assert.equal(normalizeHost("example.com."), "example.com");
  for (const bad of ["", "127.0.0.1", "http://[::1]/", "localhost", "intranet", "printer.local", "foo.internal"]) {
    assert.throws(() => normalizeHost(bad), InputError, bad);
  }
});

test("登録の単位のドメインを切り出す", () => {
  assert.equal(registrableDomain("www.example.co.jp").domain, "example.co.jp");
  assert.equal(registrableDomain("a.b.example.com").domain, "example.com");
  assert.equal(registrableDomain("www.example.co.uk").domain, "example.co.uk");
  assert.equal(registrableDomain("www.example.tokyo.jp").domain, "example.tokyo.jp");
});
