import type { Metadata } from "next";
import { requirePageAuth } from "@/lib/auth/context";
import { can, canManageRole, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Badge, Panel } from "@/components/ui/panel";
import { InviteForm, MemberRoleSelect, RemoveMemberButton, ResendInviteButton, ResetPasswordLinkButton, RevokeInviteButton } from "@/components/team/team-controls";
import { isEmailConfigured } from "@/lib/email/send";
import { formatDate, initials, relativeTime } from "@/lib/utils";
import { ROLES } from "@/lib/validation";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requirePageAuth();
  const canManage = can(ctx.role, "member:manage");

  const [members, invitations] = await Promise.all([
    db.membership.findMany({
      where: { organisationId: ctx.organisation.id },
      include: { user: { select: { id: true, name: true, email: true, isDemo: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    canManage
      ? db.invitation.findMany({
          where: { organisationId: ctx.organisation.id, acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          include: { invitedBy: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const assignableRoles = ROLES.filter((r) => canManageRole(ctx.role, r));

  return (
    <>
      <PageHeader
        title="Team"
        description={`People with access to ${ctx.organisation.name}. Roles decide what each person can change.`}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Members" description={`${members.length} ${members.length === 1 ? "person" : "people"}`} bodyClassName="p-0">
            <ul className="divide-y divide-line/70">
              {members.map((m) => {
                const isSelf = m.userId === ctx.user.id;
                const editable = canManage && !isSelf && canManageRole(ctx.role, m.role);
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold ring-1 ring-line">
                      {initials(m.user.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m.user.name} {isSelf ? <span className="text-muted">(you)</span> : null}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {m.user.isDemo ? "Shared demo login" : m.user.email}, joined {formatDate(m.createdAt)}
                      </p>
                    </div>
                    {editable ? (
                      <div className="flex items-center gap-1.5">
                        <MemberRoleSelect membershipId={m.id} role={m.role} roles={assignableRoles} />
                        {m.user.isDemo ? null : <ResetPasswordLinkButton membershipId={m.id} name={m.user.name} />}
                        <RemoveMemberButton membershipId={m.id} name={m.user.name} />
                      </div>
                    ) : (
                      <Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          {canManage && invitations.length > 0 ? (
            <Panel title="Pending invitations" bodyClassName="p-0">
              <ul className="divide-y divide-line/70">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="truncate text-xs text-muted">
                        {ROLE_LABELS[inv.role]}, invited by {inv.invitedBy?.name ?? "a former member"} {relativeTime(inv.createdAt)}, expires{" "}
                        {formatDate(inv.expiresAt)}
                      </p>
                    </div>
                    <div className="flex items-start gap-1">
                      <ResendInviteButton invitationId={inv.id} />
                      <RevokeInviteButton invitationId={inv.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          {canManage ? (
            <Panel
              title="Invite someone"
              description={
                isEmailConfigured()
                  ? "We'll email them a link to join this workspace. You'll also get the link to copy."
                  : "You'll get a one-time link to send them. (Email isn't set up yet, so it won't be sent automatically.)"
              }
            >
              <InviteForm roles={assignableRoles} />
            </Panel>
          ) : null}
          <Panel title="What each role can do">
            <dl className="space-y-3 text-sm">
              {ROLES.map((r) => (
                <div key={r}>
                  <dt className="font-medium">{ROLE_LABELS[r]}</dt>
                  <dd className="text-muted">{ROLE_DESCRIPTIONS[r]}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
