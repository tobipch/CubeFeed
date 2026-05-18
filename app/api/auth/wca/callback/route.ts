import { type NextRequest, NextResponse } from "next/server";
import { execute, query } from "@/lib/db";
import { createSession, cookieOptions, SESSION_COOKIE } from "@/lib/auth";

const WCA_TOKEN_URL = "https://www.worldcubeassociation.org/oauth/token";
const WCA_ME_URL = "https://www.worldcubeassociation.org/api/v0/me";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code || searchParams.get("error")) {
    return NextResponse.redirect(new URL("/?auth_error=1", req.url));
  }

  const state = searchParams.get("state");
  const expectedState = req.cookies.get("wca_oauth_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?auth_error=1", req.url));
  }

  const clientId = process.env.WCA_CLIENT_ID;
  const clientSecret = process.env.WCA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/?auth_error=1", req.url));
  }

  const redirectUri =
    process.env.WCA_REDIRECT_URI ??
    new URL("/api/auth/wca/callback", req.url).toString();

  try {
    const tokenRes = await fetch(WCA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL("/?auth_error=1", req.url));
    }

    const { access_token } = await tokenRes.json();

    const meRes = await fetch(WCA_ME_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!meRes.ok) {
      return NextResponse.redirect(new URL("/?auth_error=1", req.url));
    }

    const { me } = await meRes.json();
    const wcaAccountId: number = me.id;
    const wcaId: string | null = me.wca_id ?? null;
    const wcaName: string = me.name;
    const wcaAvatarUrl: string | null = me.avatar?.thumb_url ?? me.avatar?.url ?? null;

    let userId: number;
    const existing = await query<{ id: number }>(
      "SELECT id FROM users WHERE wca_account_id = ?",
      [wcaAccountId]
    );

    if (existing.length > 0) {
      userId = existing[0].id;
      await execute(
        "UPDATE users SET wca_id = COALESCE(?, wca_id), wca_name = ?, wca_avatar_url = ? WHERE id = ?",
        [wcaId, wcaName, wcaAvatarUrl, userId]
      );
    } else {
      const username = wcaId ?? `wca_${wcaAccountId}`;
      const result = await execute(
        "INSERT INTO users (username, password_hash, wca_id, wca_account_id, wca_name, wca_avatar_url) VALUES (?, NULL, ?, ?, ?, ?)",
        [username, wcaId, wcaAccountId, wcaName, wcaAvatarUrl]
      );
      userId = result.insertId;
    }

    const token = await createSession(userId);
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(30 * 24 * 60 * 60));
    res.cookies.delete("wca_oauth_state");
    return res;
  } catch (err) {
    console.error("WCA OAuth Fehler:", err);
    return NextResponse.redirect(new URL("/?auth_error=1", req.url));
  }
}
