import { expect, test } from "bun:test";

import { decodeAwsEventStreamMessages, encodeAwsEventStreamMessage } from "../../src/stream/awsEventStream";

test("round-trips a single message with json payload", () => {
  const bytes = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event", ":event-type": "chunk" },
    payload: new TextEncoder().encode(JSON.stringify({ type: "content", delta: "hi" })),
  });
  const msgs = decodeAwsEventStreamMessages(bytes);
  expect(msgs.length).toBe(1);
  expect(new TextDecoder().decode(msgs[0]!.payload)).toContain('"delta":"hi"');
});

test("decodes two concatenated messages", () => {
  const a = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new Uint8Array([1, 2, 3]),
  });
  const b = encodeAwsEventStreamMessage({
    headers: { ":message-type": "event" },
    payload: new Uint8Array([4, 5]),
  });
  const msgs = decodeAwsEventStreamMessages(new Uint8Array([...a, ...b]));
  expect(msgs.length).toBe(2);
});
