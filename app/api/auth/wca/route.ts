import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const WCA_AUTH_URL = "https://www.worldcubeassociation.org/oauth/authorize";

export async function GET(req: NextRequest) {
  const clientId = process.env.WCA_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "WCA OAuth nicht konfiguriert." }, { status: 500 });
  }

  const redirectUri =
    process.env.WCA_REDIRECT_URI ??
    new URL("/api/auth/wca/callback", req.url).toString();

  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "public",
    state,
  });

  const res = NextResponse.redirect(`${WCA_AUTH_URL}?${params}`);
  res.cookies.set("wca_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
