import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return value;
}

export const env = {
  get authSecret(): string {
    const secret = required("AUTH_SECRET");
    if (process.env.NODE_ENV === "production" && secret.length < 32) {
      throw new Error("AUTH_SECRET must be at least 32 characters in production.");
    }
    return secret;
  },
  get appUrl(): string {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get sessionTtlDays(): number {
    const days = Number(process.env.SESSION_TTL_DAYS ?? "14");
    return Number.isFinite(days) && days > 0 ? days : 14;
  },
  get demoEnabled(): boolean {
    return (process.env.DEMO_ENABLED ?? "true") !== "false";
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
