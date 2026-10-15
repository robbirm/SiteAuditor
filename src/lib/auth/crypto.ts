import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Keeps login timing constant when the email is unknown (no user enumeration).
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash("schoolverse-timing-equaliser", BCRYPT_ROUNDS);
  await bcrypt.compare(password, await dummyHash);
}

/** 256-bit random token, URL-safe. The raw value is only ever given to the client. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored as keyed HMACs so a database leak cannot be replayed. */
export function hashToken(token: string): string {
  return createHmac("sha256", env.authSecret).update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
