import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath, withNext } from "@/components/auth/safe-next";
import { clearSessionCookie, getSession } from "@/server/auth/guards";
import { deleteSession } from "@/server/auth/sessions";
import { env } from "@/server/env";
import { normaliseHost } from "@/server/tenancy/hosts";

/** Absolute URL on the app host; never built from the request's own Host. */
function appLocation(path: string): URL {
  return new URL(path, env().APP_URL);
}

/**
 * A link, a prefetch or a typed address must never sign anyone out, so GET
 * changes nothing and simply returns to the dashboard.
 */
export function GET() {
  return NextResponse.redirect(appLocation("/workspace"), 307);
}

/**
 * Signs out: removes the server-side session, clears the cookie, and answers
 * 303 so the browser follows with a GET. An optional same-origin `next` field
 * is carried to the sign-in page.
 */
export async function POST(request: NextRequest) {
  // The session cookie is SameSite=Lax, which already keeps it off cross-site
  // posts; refusing a foreign Origin makes that explicit.
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = normaliseHost(new URL(origin).host);
    } catch {
      originHost = null;
    }
    const allowed = [normaliseHost(request.headers.get("host")), normaliseHost(new URL(env().APP_URL).host)];
    if (!originHost || !allowed.includes(originHost)) return new NextResponse(null, { status: 403 });
  }

  let next: string | null = null;
  try {
    next = safeNextPath((await request.formData()).get("next"));
  } catch {
    // No body, or not a form: sign out all the same.
  }

  const session = await getSession();
  if (session) await deleteSession(session.id);
  await clearSessionCookie();

  return NextResponse.redirect(appLocation(withNext("/login", next)), 303);
}
