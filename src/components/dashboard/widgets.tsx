import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/panel";
import { ASSET_TYPE_LABELS, FAULT_PRIORITY_LABELS, FAULT_STATUS_LABELS } from "@/lib/labels";
import type { DashboardStats, SchoolSummary } from "@/lib/stats";
import { cn, daysUntil, formatDate, formatNumber, relativeTime } from "@/lib/utils";

// ─── Readout strip ───────────────────────────────────────────────────────

type Reading = { label: string; value: number; detail?: React.ReactNode; tone?: "default" | "danger" | "warning" };

/** Key figures as one continuous instrument strip rather than four boxes. */
export function Readout({ readings }: { readings: Reading[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-card md:grid-cols-4">
      {readings.map((r) => (
        <div key={r.label} className="bg-surface px-5 py-5">
          <dt className="text-[13px] text-muted">{r.label}</dt>
          <dd
            className={cn(
              "mt-1.5 font-display text-[2rem] font-semibold leading-none tabular-nums",
              r.tone === "danger" && r.value > 0 && "text-danger",
              r.tone === "warning" && r.value > 0 && "text-warning",
            )}
          >
            {formatNumber(r.value)}
          </dd>
          {r.detail ? <dd className="mt-2 text-xs text-muted">{r.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

// ─── Assets by type ──────────────────────────────────────────────────────

export function AssetMix({ items, total }: { items: DashboardStats["assetsByType"]; total: number }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No equipment recorded yet.</p>;
  }
  const top = items.slice(0, 7);
  const rest = items.slice(7).reduce((s, i) => s + i.count, 0);
  const rows = rest > 0 ? [...top, { type: "__rest", count: rest }] : top;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.type} className="grid grid-cols-[120px_minmax(0,1fr)_44px] items-center gap-3 text-[13px]">
          <span className="truncate text-muted">{row.type === "__rest" ? "Everything else" : ASSET_TYPE_LABELS[row.type]}</span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-accent/80"
              style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{formatNumber(row.count)}</span>
        </li>
      ))}
      <li className="pt-1 text-xs text-muted">{formatNumber(total)} in service, excluding retired kit.</li>
    </ul>
  );
}

// ─── Faults ──────────────────────────────────────────────────────────────

export const PRIORITY_TONE: Record<string, Tone> = { CRITICAL: "danger", HIGH: "warning", MEDIUM: "info", LOW: "neutral" };

export function FaultList({ faults, showSchool }: { faults: DashboardStats["faults"]["recent"]; showSchool: boolean }) {
  if (faults.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No open faults. Nice.</p>;
  }
  return (
    <ul className="-my-2 divide-y divide-line/70">
      {faults.map((f) => (
        <li key={f.id} className="flex items-start gap-3 py-3">
          <span
            className={cn(
              "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
              f.priority === "CRITICAL" && "bg-danger shadow-[0_0_0_4px_rgb(var(--danger)/0.15)]",
              f.priority === "HIGH" && "bg-warning",
              f.priority === "MEDIUM" && "bg-info",
              f.priority === "LOW" && "bg-muted",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              <span className="mr-1.5 font-mono text-xs text-muted">#{f.reference}</span>
              {f.title}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {[showSchool ? f.school.name : null, f.room?.name, f.asset ? `${f.asset.name} (${f.asset.assetTag})` : null]
                .filter(Boolean)
                .join(", ")}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone={PRIORITY_TONE[f.priority]}>{FAULT_PRIORITY_LABELS[f.priority]}</Badge>
            <span className="text-[11px] text-muted">
              {FAULT_STATUS_LABELS[f.status]}, {relativeTime(f.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Warranties ──────────────────────────────────────────────────────────

export function WarrantyList({ items, showSchool }: { items: DashboardStats["warranty"]["upcoming"]; showSchool: boolean }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No warranties expiring in the next 90 days.</p>;
  }
  return (
    <ul className="-my-2 divide-y divide-line/70">
      {items.map((a) => {
        const days = a.warrantyExpiry ? daysUntil(a.warrantyExpiry) : 0;
        const expired = days < 0;
        return (
          <li key={a.id} className="flex items-center gap-3 py-3">
            {expired ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-danger" aria-label="Expired" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-label="Expiring soon" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{a.name}</p>
              <p className="truncate text-xs text-muted">
                <span className="font-mono">{a.assetTag}</span>
                {showSchool ? `, ${a.school.name}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className={cn("text-xs font-medium", expired ? "text-danger" : "text-warning")}>
                {expired ? `Expired ${Math.abs(days)}d ago` : days === 0 ? "Expires today" : `${days} days left`}
              </p>
              <p className="text-[11px] text-muted">{formatDate(a.warrantyExpiry)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────

export function ActivityFeed({ items }: { items: DashboardStats["activity"] }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">Nothing has happened yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-accent ring-4 ring-surface" aria-hidden />
          <p className="text-sm leading-snug">{item.summary}</p>
          <p className="mt-0.5 text-xs text-muted">{relativeTime(item.createdAt)}</p>
        </li>
      ))}
    </ol>
  );
}

// ─── Schools table ───────────────────────────────────────────────────────

export function SchoolsTable({ schools }: { schools: SchoolSummary[] }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-5 py-3 font-medium">School</th>
            <th className="px-3 py-3 text-right font-medium">Rooms</th>
            <th className="px-3 py-3 text-right font-medium">Assets</th>
            <th className="px-3 py-3 text-right font-medium">Warranty alerts</th>
            <th className="px-5 py-3 text-right font-medium"><span className="sr-only">Floor plan</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {schools.map((s) => (
            <tr key={s.id} className="group transition-colors hover:bg-surface-2/50">
              <td className="px-5 py-3">
                <Link href={`/schools/${s.id}`} className="font-medium group-hover:text-accent">
                  {s.name}
                </Link>
                <p className="text-xs text-muted">{[s.phase, s.postcode].filter(Boolean).join(", ") || "No details yet"}</p>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNumber(s._count.rooms)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatNumber(s._count.assets)}</td>
              <td className="px-3 py-3 text-right tabular-nums">
                <span className={cn(s.warrantyAlerts > 0 && "font-semibold text-danger")}>{formatNumber(s.warrantyAlerts)}</span>
              </td>
              <td className="px-5 py-3 text-right">
                <Link href={`/schools/${s.id}/map`} className="text-xs font-medium text-accent hover:underline">
                  Floor plan
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
