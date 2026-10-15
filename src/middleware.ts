import { NextResponse, type NextRequest } from "next/server";

// Fast edge check: bounce visitors without a session cookie away from app
// routes. Real validation (session lookup, membership, permissions) happens on
// the server for every page, action and route handler — never trust this alone.
const PROTECTED_PREFIXES = ["/dashboard", "/schools", "/assets", "/settings", "/onboarding"];
const AUTH_PAGES = ["/login", "/register"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get("sv_session")?.value);

  if (!hasSession && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (hasSession && AUTH_PAGES.includes(pathname) && !request.nextUrl.searchParams.has("invite")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/health).*)"],
};
