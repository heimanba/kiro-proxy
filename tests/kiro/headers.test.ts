import { expect, test } from "bun:test";

import { buildKiroHeaders } from "../../src/kiro/headers";

test("buildKiroHeaders includes required headers and never returns raw token in logs", () => {
  const h = buildKiroHeaders({
    accessToken: "tok",
    invocationId: "00000000-0000-0000-0000-000000000000",
  });
  expect(h.authorization).toBe("Bearer tok");
  expect(h["x-amzn-codewhisperer-optout"]).toBe("true");
  expect(h["x-amzn-kiro-agent-mode"]).toBe("vibe");
  expect(h["amz-sdk-invocation-id"]).toBe("00000000-0000-0000-0000-000000000000");
  expect(h["amz-sdk-request"]).toContain("attempt=1");
});
