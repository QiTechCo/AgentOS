export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    // Try knowledge_base first, fall back to listing all collections
    let result: any = null;

    try {
      const res = await fetch("http://127.0.0.1:6333/collections/knowledge_base", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        result = data.result;
      }
    } catch (_) {
      // try listing collections instead
    }

    if (!result) {
      try {
        const res2 = await fetch("http://127.0.0.1:6333/collections", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res2.ok) {
          const data2 = await res2.json();
          const collections = data2.result?.collections || [];
          result = { points_count: 0, segments_count: collections.length, status: "ok", collections };
        }
      } catch (_) {}
    }

    clearTimeout(timeout);
    return NextResponse.json({ qdrant: result || { points_count: 0, status: "unavailable" } });
  } catch (err) {
    return NextResponse.json({ qdrant: { points_count: 0, status: "offline" } });
  }
}
