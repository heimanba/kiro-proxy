import { expect, test } from "bun:test";

import { resolveKiroModelId } from "../../src/kiro/modelResolver";

test("resolveKiroModelId: maps *-latest to auto", () => {
  expect(resolveKiroModelId("claude-3-5-sonnet-latest")).toBe("auto");
  expect(resolveKiroModelId("CLAUDE-3-5-HAIKU-LATEST")).toBe("auto");
});

test("resolveKiroModelId: normalizes claude family versions", () => {
  expect(resolveKiroModelId("claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
  expect(resolveKiroModelId("claude-opus-4-5")).toBe("claude-opus-4.5");
  expect(resolveKiroModelId("claude-haiku-4.5")).toBe("claude-haiku-4.5");
  expect(resolveKiroModelId("claude-sonnet-4")).toBe("claude-sonnet-4");
});

test("resolveKiroModelId: leaves unknown models untouched", () => {
  expect(resolveKiroModelId("deepseek-3.2")).toBe("deepseek-3.2");
  expect(resolveKiroModelId("x")).toBe("x");
});

