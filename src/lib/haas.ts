const HAAS_URL = process.env.HAAS_URL || "http://localhost:8080";

export interface Environment {
  id: string;
  status: string;
  image: string;
}

export interface ExecEvent {
  stream: "stdout" | "stderr" | "exit";
  data: string;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  mod_time: string;
}

export async function createEnvironment(
  image: string,
  opts?: { cpu?: number; memory_mb?: number; network_policy?: string }
): Promise<Environment> {
  const res = await fetch(`${HAAS_URL}/v1/environments/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, ...opts }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create environment");
  }
  return res.json();
}

export async function destroyEnvironment(id: string): Promise<void> {
  const res = await fetch(`${HAAS_URL}/v1/environments/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error("Failed to destroy environment");
  }
}

export async function execCommand(
  envId: string,
  command: string[],
  opts?: { working_dir?: string; timeout_seconds?: number }
): Promise<{ stdout: string; stderr: string; exitCode: string }> {
  const res = await fetch(`${HAAS_URL}/v1/environments/${envId}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, ...opts }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Exec failed");
  }

  // Parse NDJSON response
  const text = await res.text();
  let stdout = "";
  let stderr = "";
  let exitCode = "0";

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event: ExecEvent = JSON.parse(line);
      if (event.stream === "stdout") stdout += event.data;
      else if (event.stream === "stderr") stderr += event.data;
      else if (event.stream === "exit") exitCode = event.data;
    } catch {
      // skip malformed lines
    }
  }

  return { stdout, stderr, exitCode };
}

export async function writeFile(
  envId: string,
  path: string,
  content: string
): Promise<void> {
  const res = await fetch(
    `${HAAS_URL}/v1/environments/${envId}/files/content?path=${encodeURIComponent(path)}`,
    { method: "PUT", body: content }
  );
  if (!res.ok) {
    throw new Error("Failed to write file");
  }
}

export async function readFile(
  envId: string,
  path: string
): Promise<string> {
  const res = await fetch(
    `${HAAS_URL}/v1/environments/${envId}/files/content?path=${encodeURIComponent(path)}`
  );
  if (!res.ok) {
    throw new Error("Failed to read file");
  }
  return res.text();
}

export async function listFiles(
  envId: string,
  path: string
): Promise<FileInfo[]> {
  const res = await fetch(
    `${HAAS_URL}/v1/environments/${envId}/files/?path=${encodeURIComponent(path)}`
  );
  if (!res.ok) {
    throw new Error("Failed to list files");
  }
  return res.json();
}
