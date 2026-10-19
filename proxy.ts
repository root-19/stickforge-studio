import { NextResponse, type NextRequest } from "next/server";

/**
 * App pages need a session cookie; without one, go straight to /login
 * (the API re-checks the session on every request, so this is just a fast path).
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("sf_session")?.value) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/templates/:path*", "/voice/:path*", "/editor/:path*", "/voices/:path*", "/exports/:path*", "/settings/:path*"],
};
