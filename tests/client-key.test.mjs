import { test } from "node:test";
import assert from "node:assert/strict";
import { clientKey } from "../src/client-key.js";

test("IPv4 はそのまま数える", () => {
  assert.equal(clientKey("203.0.113.5"), "203.0.113.5");
});

test("IPv6 は同じ /64 なら同じ接続元として数える", () => {
  assert.equal(clientKey("2001:db8:1:2::1"), clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
  assert.notEqual(clientKey("2001:db8:1:2::1"), clientKey("2001:db8:1:3::1"));
});

test("接続元が分からないときはひとまとめにする", () => {
  assert.equal(clientKey(null), "unknown");
});
