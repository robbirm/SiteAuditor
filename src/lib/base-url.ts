import "server-only";
import { headers } from "next/headers";

/**
 * Public URL for links in emails and invitations. Uses APP_URL when it's set
 * to a real address; otherwise falls back to the host the request came in on,
 * so links still work if APP_URL was left at its localhost default.
 */
export async function getBaseUrl(): Promise<string> {
  const configured = (process.env.APP_URL ?? "").trim().replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const requestUrl = host ? `${proto.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}` : null;

  const configuredIsLocal = !configured || /localhost|127\.0\.0\.1/.test(configured);
  const requestIsLocal = !requestUrl || /localhost|127\.0\.0\.1/.test(requestUrl);
  if (configuredIsLocal && !requestIsLocal) return requestUrl!;
  return configured || requestUrl || "http://localhost:3000";
}
