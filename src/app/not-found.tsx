import Link from "next/link";
import { Logo } from "@/components/brand";
import { buttonClasses } from "@/components/ui/button-classes";

export default function NotFound() {
  return (
    <div className="blueprint flex min-h-dvh items-center justify-center px-5">
      <div className="max-w-md text-center">
        <Logo className="mb-8 justify-center" />
        <h1 className="font-display text-3xl font-semibold">Nothing on the plan here</h1>
        <p className="mt-3 text-muted">
          This page doesn&apos;t exist, or it belongs to a workspace you don&apos;t have access to.
        </p>
        <Link href="/dashboard" className={buttonClasses("primary", "md", "mt-7")}>
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
