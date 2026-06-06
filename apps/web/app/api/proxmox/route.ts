export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { execSync } from "child_process";

function safeExec(cmd: string): any {
  try {
    const out = execSync(cmd, { timeout: 8000, encoding: "utf-8" });
    return JSON.parse(out.trim());
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const nodeStatus = safeExec("pvesh get /nodes/pve/status --output-format json 2>/dev/null");
    const containers = safeExec("pvesh get /nodes/pve/lxc --output-format json 2>/dev/null");
    const storage = safeExec("pvesh get /nodes/pve/storage --output-format json 2>/dev/null");

    return NextResponse.json({
      nodeStatus,
      containers: containers || [],
      storage: storage || [],
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch Proxmox data" }, { status: 500 });
  }
}
