import Link from "next/link";
import { Boxes, Building2, Cable, CalendarClock, School, Users } from "lucide-react";
import { Logo } from "@/components/brand";
import { buttonClasses } from "@/components/ui/button-classes";
import { DemoButton } from "@/components/marketing/demo-button";
import { BuildingHero } from "@/components/marketing/building-hero";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { CABLE_COLOURS, CABLE_SHORT_LABELS, isFibre } from "@/lib/cabling";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Building2,
    title: "Floors you can see",
    body: "Build each floor as a 3D plan. Add rooms in seconds, then drag them into place and resize them to the metre.",
  },
  {
    icon: Boxes,
    title: "Equipment where it lives",
    body: "Every PC, display, access point and switch sits in its room on the plan, so you can see what's where at a glance.",
  },
  {
    icon: Cable,
    title: "Cable runs, traced",
    body: "Draw each Ethernet and fibre route through the building. SchoolVerse measures the length and records the cable type.",
  },
  {
    icon: CalendarClock,
    title: "A register with warranty alerts",
    body: "Search by name, tag, serial number, IP address or who it's assigned to, and see which warranties are running out.",
  },
  {
    icon: School,
    title: "Every school in one place",
    body: "Run one site or fifty. Each school has its own buildings, rooms, equipment and cabling, with live totals on the dashboard.",
  },
  {
    icon: Users,
    title: "Built for a team",
    body: "Invite technicians and colleagues as owners, admins, technicians or viewers. Each role only sees the controls it can use.",
  },
];

const STEPS = [
  { title: "Add a school", body: "Name it, then add its buildings and floors." },
  { title: "Lay out the rooms", body: "Pick a size, drop each room in and drag it into position." },
  { title: "Fill them with equipment", body: "Add devices straight onto a room, or from the asset register." },
  { title: "Trace the cabling", body: "Click along the route of each run and choose Cat5e, Cat6, Cat6a or fibre." },
];

const CABLE_KEY = ["CAT5E", "CAT6", "CAT6A", "FIBRE_SM", "FIBRE_MM"];

export default async function LandingPage() {
  const session = await getSession();
  const signedIn = Boolean(session);

  return (
    <div className="relative overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/dashboard" className={buttonClasses("primary", "sm")}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonClasses("ghost", "sm")}>
                Sign in
              </Link>
              <Link href="/register" className={buttonClasses("secondary", "sm")}>
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] lg:pt-14">
          <div>
            <h1 className="font-display text-[2.5rem] font-semibold leading-[1.05] sm:text-[3.3rem]">
              Every room, every device and every cable run, mapped in 3D.
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
              SchoolVerse lets school IT teams and support partners lay out each floor, place equipment in the room it lives in
              and trace Ethernet and fibre through the building, with a searchable asset register behind it all.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={signedIn ? "/dashboard" : "/register"} className={buttonClasses("primary", "lg")}>
                {signedIn ? "Go to your dashboard" : "Create a free workspace"}
              </Link>
              {env.demoEnabled ? <DemoButton variant="secondary" size="lg" /> : null}
            </div>
            <p className="mt-4 text-[13px] text-muted">The demo is a fictional secondary school you can explore, read-only.</p>
          </div>

          <div className="blueprint rounded-[22px] border border-line p-3 shadow-card sm:p-4">
            <BuildingHero />
          </div>
        </section>

        <section className="border-y border-line/70 bg-surface/40">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-semibold leading-tight">The layout, the kit and the cabling, in one place.</h2>
              <p className="mt-4 text-muted">
                Spreadsheets tell you what you own. SchoolVerse shows you where it is and how it&apos;s connected.
              </p>
            </div>
            <dl className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="border-l-2 border-accent/40 pl-5">
                  <dt className="flex items-center gap-2.5 font-display text-[17px] font-semibold">
                    <Icon className="h-[18px] w-[18px] text-accent" aria-hidden />
                    {title}
                  </dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-muted">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
            <div>
              <h2 className="font-display text-3xl font-semibold leading-tight">From empty floor to mapped site in an afternoon.</h2>
              <ol className="mt-8 space-y-5">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-accent/40 bg-accent/10 font-display text-sm font-semibold text-accent">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium">{step.title}</p>
                      <p className="text-[15px] text-muted">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-6">
              <h3 className="font-display text-lg font-semibold">Know what&apos;s in the ceiling</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                Each run is drawn in its own colour by type, with fibre dashed so it stands out from copper. Select one to see its
                length, the rooms at each end and any notes, such as patch panel ports or core counts.
              </p>
              <ul className="mt-6 space-y-3">
                {CABLE_KEY.map((t) => (
                  <li key={t} className="flex items-center gap-3 text-sm">
                    <svg width="44" height="8" aria-hidden>
                      <line x1="2" y1="4" x2="42" y2="4" stroke={CABLE_COLOURS[t]} strokeWidth="3" strokeLinecap="round" strokeDasharray={isFibre(t) ? "7 4" : undefined} />
                    </svg>
                    {CABLE_SHORT_LABELS[t]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t border-line/70 bg-surface/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-3xl font-semibold leading-tight">Every school stays in its own lane.</h2>
              <p className="mt-4 leading-relaxed text-muted">
                Each organisation is a sealed workspace. Schools, rooms, equipment and cabling are scoped to it on every request,
                and team members only get the access their role allows.
              </p>
            </div>
            <ul className="space-y-3 text-[15px]">
              {[
                "Passwords hashed with bcrypt; sessions stored on the server and revocable",
                "Permissions checked on every action, not just hidden in the menu",
                "Password resets by single-use link, and admin-issued links for your team",
                "An activity log of who changed what, and when",
              ].map((item) => (
                <li key={item} className="flex gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm bg-accent" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Logo />
          <p>IT estate mapping for schools and the people who support them.</p>
        </div>
      </footer>
    </div>
  );
}
