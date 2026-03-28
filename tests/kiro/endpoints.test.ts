import { expect, test } from "bun:test";

import { buildListAvailableModelsUrl } from "../../src/kiro/endpoints";

test("ListAvailableModels always includes origin=AI_EDITOR", () => {
  const u = buildListAvailableModelsUrl({
    region: "us-east-1",
    profileArn: undefined,
    includeProfileArn: false,
  });
  expect(u).toContain("origin=AI_EDITOR");
});

test("ListAvailableModels includes profileArn only when Desktop mode + profileArn exists", () => {
  const u = buildListAvailableModelsUrl({
    region: "us-east-1",
    profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/x",
    includeProfileArn: true,
  });
  expect(u).toContain("profileArn=");
});
