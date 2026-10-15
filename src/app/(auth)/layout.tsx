import { Logo } from "@/components/brand";
import { BuildingHero } from "@/components/marketing/building-hero";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </div>
      <aside className="blueprint relative hidden items-center justify-center border-l border-line p-12 lg:flex">
        <div className="w-full max-w-xl">
          <BuildingHero />
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted">
            Lay out every floor, place every device and trace every cable run.
          </p>
        </div>
      </aside>
    </div>
  );
}
