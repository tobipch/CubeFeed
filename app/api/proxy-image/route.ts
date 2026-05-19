import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Only allow WCA avatar URLs to prevent SSRF
  if (!url.startsWith("https://www.worldcubeassociation.org/")) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 403 });
  }

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: "Upstream error" }, { status: 502 });
  }

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = await res.arrayBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
