import { NextRequest } from "next/server";

const HAAS_URL = process.env.HAAS_URL || "http://localhost:8080";

export async function GET(req: NextRequest) {
  const envId = req.nextUrl.searchParams.get("env_id");
  const filePath = req.nextUrl.searchParams.get("path");

  if (!envId || !filePath) {
    return Response.json(
      { error: "env_id and path are required" },
      { status: 400 }
    );
  }

  try {
    const haasRes = await fetch(
      `${HAAS_URL}/v1/environments/${envId}/files/content?path=${encodeURIComponent(filePath)}`
    );

    if (!haasRes.ok) {
      const text = await haasRes.text();
      return Response.json(
        { error: `HaaS error: ${text}` },
        { status: haasRes.status }
      );
    }

    // Forward the response with headers from HaaS
    const headers = new Headers();

    const contentType = haasRes.headers.get("Content-Type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }

    const disposition = haasRes.headers.get("Content-Disposition");
    if (disposition) {
      headers.set("Content-Disposition", disposition);
    } else {
      // Fallback: derive filename from path
      const fileName = filePath.split("/").pop() || "download";
      headers.set(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );
    }

    return new Response(haasRes.body, { headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
