export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const HERMES_HOME = "/mnt/lxc102/root/.hermes";

export async function GET() {
  // Check both memories/ subfolder and root .hermes for each file
  const files = ["MEMORY.md", "USER.md", "CREATIVE.md", "SOUL.md"];
  const workspace: Record<string, string | null> = {};

  for (const file of files) {
    // Try memories/ first, then root hermes dir
    const paths = [
      path.join(HERMES_HOME, "memories", file),
      path.join(HERMES_HOME, file),
    ];
    let content: string | null = null;
    for (const p of paths) {
      try {
        const raw = fs.readFileSync(p, "utf-8").trim();
        if (raw.length > 0) {
          content = raw;
          break;
        }
      } catch (_) {}
    }
    workspace[file] = content;
  }

  return NextResponse.json({ workspace });
}
