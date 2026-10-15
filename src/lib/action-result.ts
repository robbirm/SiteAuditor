import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AuthError, ForbiddenError, NotFoundError } from "@/lib/auth/context";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Free-form payload, e.g. an invitation link to display once. */
  data?: Record<string, string>;
};

export function fromZod(error: ZodError): ActionState {
  return {
    error: "Please check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/** Converts known errors into user-safe messages; logs everything else. */
export function toActionError(error: unknown): ActionState {
  if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof NotFoundError) {
    return { error: error.message };
  }
  if (error instanceof ZodError) {
    return { error: "That request wasn't valid. Refresh the page and try again." };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { error: "A record with those details already exists." };
  }
  // Setup problems get a pointer to the health check instead of a vague error.
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P1001"))
  ) {
    console.error("[action] database not ready", error);
    return { error: "The database isn't set up correctly yet. An administrator can check /api/health for details." };
  }
  if (error instanceof Error && error.message.includes("Missing required environment variable")) {
    console.error("[action] configuration error", error);
    return { error: "The app is missing a required setting. An administrator can check /api/health for details." };
  }
  // Never leak internal details to the client.
  console.error("[action] unexpected error", error);
  return { error: "Something went wrong. Please try again." };
}

/**
 * next/navigation's redirect() works by throwing; it must be re-thrown from
 * try/catch blocks rather than reported as an error.
 */
export function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
