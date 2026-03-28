export function buildKiroHeaders(input: { accessToken: string; invocationId: string }) {
  const fingerprint = "kiro-ide-proxy";
  return {
    authorization: `Bearer ${input.accessToken}`,
    "content-type": "application/json",
    "user-agent":
      `aws-sdk-js/1.0.27 ua/2.1 os/darwin lang/js md/nodejs api/codewhispererstreaming#1.0.27 m/E KiroIDE-0.7.45-${fingerprint}`,
    "x-amz-user-agent": `aws-sdk-js/1.0.27 KiroIDE-0.7.45-${fingerprint}`,
    "x-amzn-codewhisperer-optout": "true",
    "x-amzn-kiro-agent-mode": "vibe",
    "amz-sdk-invocation-id": input.invocationId,
    "amz-sdk-request": "attempt=1; max=3",
  } as const;
}
