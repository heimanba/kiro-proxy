export function openAiJsonError(
  status: number,
  message: string,
  type: "invalid_request_error" | "authentication_error" | "server_error",
): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type,
        code: null,
      },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

export function anthropicJsonError(
  status: number,
  message: string,
  errorType: "invalid_request_error" | "authentication_error",
): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: errorType,
        message,
      },
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

export function anthropicNotImplementedResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: "api_error",
        message,
      },
    }),
    {
      status: 501,
      headers: { "content-type": "application/json" },
    },
  );
}
