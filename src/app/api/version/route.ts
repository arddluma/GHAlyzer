import { NextResponse } from "next/server";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({
    sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
    repo: "arddluma/GHAlyzer",
    built_at: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
  });
}
