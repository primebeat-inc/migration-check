import { test } from "node:test";
import assert from "node:assert/strict";
import { challenge, isOwnerVerified, issueProof, isProofValid } from "../src/owner.js";

const SECRET = "test-secret";

test("確認の値はドメインごとに違い、同じドメインなら同じ", async () => {
  const a = await challenge(SECRET, "example.co.jp");
  assert.equal(a.name, "_pb-migration-check.example.co.jp");
  assert.deepEqual(a, await challenge(SECRET, "example.co.jp"));
  assert.notEqual(a.value, (await challenge(SECRET, "example.com")).value);
  assert.notEqual(a.value, (await challenge("other-secret", "example.co.jp")).value);
});

test("DNS の TXT に確認の値が入っていれば持ち主と認める", async () => {
  const { value } = await challenge(SECRET, "example.co.jp");
  assert.equal(await isOwnerVerified(SECRET, "example.co.jp", async () => [`"${value}"`]), true);
  assert.equal(await isOwnerVerified(SECRET, "example.co.jp", async () => ['"pb-migration-check=wrong"']), false);
  assert.equal(await isOwnerVerified(SECRET, "example.co.jp", async () => []), false);
});

test("証明は同じドメインで1時間だけ通る", async () => {
  const now = Date.now();
  const proof = await issueProof(SECRET, "example.co.jp", now);
  assert.equal(await isProofValid(SECRET, "example.co.jp", proof, now + 1000), true);
  assert.equal(await isProofValid(SECRET, "example.com", proof, now + 1000), false);
  assert.equal(await isProofValid(SECRET, "example.co.jp", proof, now + 2 * 60 * 60 * 1000), false);
  assert.equal(await isProofValid(SECRET, "example.co.jp", "123.forged", now), false);
});
