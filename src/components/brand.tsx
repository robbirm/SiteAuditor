import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="rgb(var(--navy))" stroke="rgb(var(--accent) / 0.35)" />
      <path d="M7 23V12l9-5 9 5v11" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="12" y="15" width="8" height="8" rx="1.5" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" />
      <circle cx="16" cy="19" r="1.6" fill="rgb(var(--accent))" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-display text-[17px] font-semibold tracking-tight">SchoolVerse</span>
    </Link>
  );
}
