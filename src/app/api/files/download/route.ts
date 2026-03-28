import { NextRequest } from "next/server";

const HAAS_URL = process.env.HAAS_URL || "http://localhost:8080";

// Validate env_id format to prevent SSRF via path manipulation
const ENV_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function sanitizeFilename(raw: string): string {
  // Take only the basename, strip control chars and quotes
  const basename = raw.split("/").pop() || "download";
  return basename.replace(/[^\w.\-]/g, "_");
}

export async function GET(req: NextRequest) {
  const envId = req.nextUrl.searchParams.get("env_id");
  const filePath = req.nextUrl.searchParams.get("path");

  if (!envId || !filePath) {
    return Response.json(
      { error: "env_id and path are required" },
      { status: 400 }
    );
  }

  if (!ENV_ID_PATTERN.test(envId)) {
    return Response.json(
      { error: "Invalid env_id format" },
      { status: 400 }
    );
  }

  if (!filePath.startsWith("/")) {
    return Response.json(
      { error: "path must be an absolute path" },
      { status: 400 }
    );
  }

  try {
    const haasApiKey = process.env.HAAS_API_KEY;
    const haasRes = await fetch(
      `${HAAS_URL}/v1/environments/${envId}/files/content?path=${encodeURIComponent(filePath)}`,
      haasApiKey ? { headers: { Authorization: `Bearer ${haasApiKey}` } } : undefined
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

    const fileName = sanitizeFilename(filePath);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    return new Response(haasRes.body, { headers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
