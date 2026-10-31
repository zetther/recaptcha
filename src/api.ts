export type Challenge = {
  id: string;
  prompt: string;
  target: string;
  expiresAt: number;
  tiles: { id: string; url: string }[];
};
export type Token = { value: string; expiresAt: number };
export type Activity = {
  created: number;
  solved: number;
  accepted: number;
  rejected: number;
  averageMs: number | null;
  events: { id: number; kind: string; at: number; duration: number | null }[];
};
export const errors: Record<string, string> = {
  "incorrect-answer": "Not quite right. Please check the images you selected.",
  "attempts-exhausted": "Attempt limit reached. Load a new challenge.",
  "expired-or-used-challenge":
    "This challenge has expired. Load a new challenge.",
  "invalid-challenge": "This challenge is unavailable. Please reload it.",
  "timeout-or-duplicate":
    "This token was used or has expired. Please verify again.",
  "rate-limited":
    "Too many attempts. Wait a minute and try again.",
  "origin-not-allowed": "This domain is not allowed by the CAPTCHA server.",
  "invalid-sitekey": "The server does not recognize this site key.",
  "invalid-request": "Invalid request. Please check your input.",
  "invalid-response": "Invalid verification token.",
  "context-mismatch": "This token does not match the session or action.",
};
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok || data.success === false)
    throw new Error(
      errors[data.error] ??
        "The server could not process your request. Try again.",
    );
  return data;
}
