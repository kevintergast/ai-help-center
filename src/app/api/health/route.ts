import { NextResponse } from "next/server";

// Health-Check (für Monitoring / CI-Smoke-Test). Kein Produkt-Feature.
export async function GET() {
  return NextResponse.json({ status: "ok", service: "hallofhelp" });
}
