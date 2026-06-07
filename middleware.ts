import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAMES = ["mtg_inventory_session", "boxleague_session"];
const PUBLIC_PREFIXES = ["/", "/login", "/public", "/u", "/api/public"];
const PROTECTED_PREFIXES = [
  "/admin",
  "/change-password",
  "/imports",
  "/inventory",
  "/locations",
  "/settings",
  "/trades",
  "/api/imports",
  "/api/inventory",
  "/api/scryfall",
];

function hasSession(request: NextRequest) {
  return SESSION_COOKIE_NAMES.some((name) =>
    Boolean(request.cookies.get(name)),
  );
}

function pathStartsWith(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathStartsWith(pathname, PUBLIC_PREFIXES)) {
    return NextResponse.next();
  }

  if (pathStartsWith(pathname, PROTECTED_PREFIXES) && !hasSession(request)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
