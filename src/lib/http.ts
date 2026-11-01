const NO_STORE = "no-store";

/** JSON response. Callers pass extra headers, which override the defaults. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": NO_STORE,
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { "cache-control": NO_STORE, ...headers } });
}
