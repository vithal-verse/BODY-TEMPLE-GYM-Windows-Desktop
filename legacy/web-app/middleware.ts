import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and the brand/icon files,
     * so auth checks don't run on every image/CSS request.
     */
    "/((?!_next/static|_next/image|brand|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
