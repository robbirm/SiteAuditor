"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { getSchoolOrThrow } from "@/lib/tenant";
import { fromZod, toActionError, type ActionState } from "@/lib/action-result";
import { formToObject, idSchema, schoolSchema } from "@/lib/validation";

export async function createSchoolAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let schoolId: string;
  try {
    const ctx = await authorize("school:create");
    const parsed = schoolSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);

    const school = await db.school.create({
      data: { ...parsed.data, organisationId: ctx.organisation.id },
    });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "school.created",
      entityType: "school",
      entityId: school.id,
      summary: `${ctx.user.name} added ${school.name}`,
    });
    schoolId = school.id;
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/dashboard");
  revalidatePath("/schools");
  redirect(`/schools/${schoolId}`);
}

export async function updateSchoolAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("school:update");
    const id = idSchema.parse(formData.get("schoolId"));
    await getSchoolOrThrow(ctx.organisation.id, id);

    const parsed = schoolSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);

    // updateMany with the organisation filter is a second, belt-and-braces scope check.
    await db.school.updateMany({ where: { id, organisationId: ctx.organisation.id }, data: parsed.data });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "school.updated",
      entityType: "school",
      entityId: id,
      summary: `${ctx.user.name} updated ${parsed.data.name}`,
    });
    revalidatePath(`/schools/${id}`);
    revalidatePath("/schools");
    revalidatePath("/dashboard");
    return { ok: true, message: "School details saved." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteSchoolAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("school:delete");
    const id = idSchema.parse(formData.get("schoolId"));
    const school = await getSchoolOrThrow(ctx.organisation.id, id);

    const confirmation = String(formData.get("confirmName") ?? "").trim();
    if (confirmation !== school.name) {
      return { fieldErrors: { confirmName: ["Type the school name exactly to confirm."] } };
    }

    await db.school.deleteMany({ where: { id, organisationId: ctx.organisation.id } });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "school.deleted",
      entityType: "school",
      entityId: id,
      summary: `${ctx.user.name} deleted ${school.name} and all of its records`,
    });
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/schools");
  revalidatePath("/dashboard");
  redirect("/schools");
}
