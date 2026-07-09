import test from "node:test";
import assert from "node:assert/strict";
import { createFrameDecoder, encodeWebSocketFrame } from "./websocket-utils.mjs";


test("encodes server text frames", () => {
  const frame = encodeWebSocketFrame({ ok: true });
  assert.equal(frame[0], 0x81);
  assert.equal(frame.subarray(2).toString("utf8"), "{\"ok\":true}");
});

test("decodes masked client text frames", () => {
  const messages = [];
  const decode = createFrameDecoder((text) => messages.push(text));
  decode(maskedTextFrame(JSON.stringify({ command: "connect" })));
  assert.deepEqual(messages, ['{"command":"connect"}']);
});

function maskedTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = [0x81, 0x80 | payload.length, ...mask];
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
  return Buffer.concat([Buffer.from(header), masked]);
}

