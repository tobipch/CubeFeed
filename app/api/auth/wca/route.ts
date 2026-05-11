import { type NextRequest, NextResponse } from "next/server";

const WCA_AUTH_URL = "https://www.worldcubeassociation.org/oauth/authorize";

export async function GET(req: NextRequest) {
  const clientId = process.env.WCA_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "WCA OAuth nicht konfiguriert." }, { status: 500 });
  }

  const redirectUri =
    process.env.WCA_REDIRECT_URI ??
    new URL("/api/auth/wca/callback", req.url).toString();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "public",
  });

  return NextResponse.redirect(`${WCA_AUTH_URL}?${params}`);
}
