export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import https from "https";

const apiKey = "6l1om2b2uo-AN1B8hr4JrR54m-hw9_Az";
const localIp = "10.10.10.1";

function fetchUnifi(path: string): Promise<any> {
  return new Promise((resolve) => {
    const options = {
      hostname: localIp,
      port: 443,
      path: path,
      method: "GET",
      rejectUnauthorized: false,
      headers: {
        "X-API-KEY": apiKey,
        "Accept": "application/json"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on("error", () => {
      resolve(null);
    });

    req.end();
  });
}

export async function GET() {
  try {
    const [sysinfo, health, device, sta] = await Promise.all([
      fetchUnifi("/proxy/network/api/s/default/stat/sysinfo"),
      fetchUnifi("/proxy/network/api/s/default/stat/health"),
      fetchUnifi("/proxy/network/api/s/default/stat/device"),
      fetchUnifi("/proxy/network/api/s/default/stat/sta")
    ]);

    return NextResponse.json({
      sysinfo: sysinfo?.data?.[0] || null,
      health: health?.data || [],
      devices: device?.data || [],
      clients: sta?.data || []
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch UniFi data" }, { status: 500 });
  }
}
