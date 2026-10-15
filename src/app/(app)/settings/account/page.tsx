import type { Metadata } from "next";
import { Laptop, Smartphone } from "lucide-react";
import { requirePageAuth } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Badge, Panel } from "@/components/ui/panel";
import { ChangePasswordForm, ProfileForm, SignOutOthersButton } from "@/components/account/account-forms";
import { formatDate, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Account" };

/** Turns a user-agent string into something a person recognises. */
function describeDevice(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /iPhone|Android|Mobile|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

export default async function AccountPage() {
  const ctx = await requirePageAuth();
  const isDemo = ctx.user.isDemo;

  const [user, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { name: true, email: true, createdAt: true } }),
    isDemo
      ? Promise.resolve([])
      : db.session.findMany({
          where: { userId: ctx.user.id, expiresAt: { gt: new Date() } },
          orderBy: { lastSeenAt: "desc" },
          select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true },
        }),
  ]);

  return (
    <>
      <PageHeader title="Account" description="Your personal details and sign-in security." />

      {isDemo ? (
        <p className="mb-6 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
          You&apos;re using the shared demo login, so these settings are locked. Create your own account to manage them.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Profile">
            <ProfileForm name={user.name} email={user.email} disabled={isDemo} />
          </Panel>
          <Panel title="Password" description="Changing it signs you out on every other device.">
            <ChangePasswordForm disabled={isDemo} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Workspaces">
            <ul className="space-y-2.5 text-sm">
              {ctx.memberships.map((m) => (
                <li key={m.organisationId} className="flex items-center justify-between gap-3">
                  <span className="truncate">{m.name}</span>
                  <Badge tone={m.organisationId === ctx.organisation.id ? "accent" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                </li>
              ))}
            </ul>
            {!isDemo ? <p className="mt-4 text-xs text-muted">Member since {formatDate(user.createdAt)}.</p> : null}
          </Panel>

          {!isDemo ? (
            <Panel
              title="Signed-in devices"
              description="Sessions that can currently access your account."
              action={sessions.length > 1 ? <SignOutOthersButton disabled={false} /> : null}
            >
              <ul className="-my-2 divide-y divide-line/70">
                {sessions.map((s) => {
                  const device = describeDevice(s.userAgent);
                  const Icon = device.mobile ? Smartphone : Laptop;
                  const current = s.id === ctx.sessionId;
                  return (
                    <li key={s.id} className="flex items-center gap-3 py-3">
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{device.label}</p>
                        <p className="text-xs text-muted">
                          Signed in {formatDate(s.createdAt)}, active {relativeTime(s.lastSeenAt)}
                        </p>
                      </div>
                      {current ? <Badge tone="success">This device</Badge> : null}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
