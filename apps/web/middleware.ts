import { withAgentReadability } from "@vercel/agent-readability/next";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PREVIEW_BOTS = /slackbot|discordbot/i;

const agentMarkdown = withAgentReadability({
  docsPrefix: "/",
  rewrite: (pathname) =>
    pathname === "/" ? "/api/docs-md" : `/api/docs-md${pathname}`,
  canonicalUrl: () => null,
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  const ua = req.headers.get("user-agent") ?? "";
  if (PREVIEW_BOTS.test(ua)) {
    return NextResponse.next();
  }
  return agentMarkdown(req, event);
}

export const config = {
  matcher:
    "/((?!_next|api|og|.*\\..*|favicon|manifest|robots|health|status).*)",
};
