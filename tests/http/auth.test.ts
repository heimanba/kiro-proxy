import { describe, expect, test } from "bun:test";
import { assertProxyApiKey, UnauthorizedError } from "../../src/http/auth";

describe("assertProxyApiKey", () => {
  const expectedKey = "test-proxy-key";

  test("passes with Authorization Bearer key", () => {
    const headers = new Headers({
      Authorization: `Bearer ${expectedKey}`,
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).not.toThrow();
  });

  test("passes with x-api-key header", () => {
    const headers = new Headers({
      "x-api-key": expectedKey,
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).not.toThrow();
  });

  test("passes with case-insensitive Bearer scheme", () => {
    const headers = new Headers({
      Authorization: `bEaReR ${expectedKey}`,
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).not.toThrow();
  });

  test("passes with multiple spaces between scheme and token", () => {
    const headers = new Headers({
      Authorization: `Bearer    ${expectedKey}`,
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).not.toThrow();
  });

  test("passes with tab between scheme and token", () => {
    const headers = new Headers({
      Authorization: `Bearer\t${expectedKey}`,
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).not.toThrow();
  });

  test("throws when Bearer token is empty", () => {
    const headers = new Headers({
      Authorization: "Bearer ",
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).toThrow(
      UnauthorizedError,
    );
  });

  test("throws when scheme is not Bearer and no x-api-key", () => {
    const headers = new Headers({
      Authorization: `Basic ${expectedKey}`,
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).toThrow(
      UnauthorizedError,
    );
  });

  test("passes when Authorization is invalid but x-api-key is valid", () => {
    const headers = new Headers({
      Authorization: "Bearer ",
      "x-api-key": expectedKey,
    });

    expect(() => assertProxyApiKey(headers, expectedKey)).not.toThrow();
  });

  test("throws UnauthorizedError when key is missing", () => {
    const headers = new Headers();

    expect(() => assertProxyApiKey(headers, expectedKey)).toThrow(
      UnauthorizedError,
    );
  });
});
