import { type NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { createSession, cookieOptions, SESSION_COOKIE } from "@/lib/auth";

const WCA_TOKEN_URL = "https://www.worldcubeassociation.org/oauth/token";
const WCA_ME_URL = "https://www.worldcubeassociation.org/api/v0/me";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code || searchParams.get("error")) {
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

    let userId: number;
    const existing = await sql<{ id: number }[]>`
      SELECT id FROM users WHERE wca_account_id = ${wcaAccountId}
    `;

    if (existing.length > 0) {
      userId = existing[0].id;
      if (wcaId) {
        await sql`UPDATE users SET wca_id = ${wcaId} WHERE id = ${userId}`;
      }
    } else {
      // Use WCA competition ID as username if available, otherwise wca_<id>
      const username = wcaId ?? `wca_${wcaAccountId}`;
      const inserted = await sql<{ id: number }[]>`
        INSERT INTO users (username, password_hash, wca_id, wca_account_id)
        VALUES (${username}, NULL, ${wcaId}, ${wcaAccountId})
        RETURNING id
      `;
      userId = inserted[0].id;
    }

    const token = await createSession(userId);
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(30 * 24 * 60 * 60));
    return res;
  } catch (err) {
    console.error("WCA OAuth Fehler:", err);
    return NextResponse.redirect(new URL("/?auth_error=1", req.url));
  }
}
