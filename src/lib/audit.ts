import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type AuditInput = {
  organisationId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
};

/** Records who did what. Failures are logged, never surfaced to the user. */
export async function audit(input: AuditInput, tx: Prisma.TransactionClient = db): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        organisationId: input.organisationId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary.slice(0, 500),
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log", error);
  }
}
