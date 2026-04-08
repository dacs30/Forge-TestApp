const MCP_URL = process.env.MCP_URL || "http://localhost:8091";

export interface McpToolAsOpenAI {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/**
 * Minimal MCP client over SSE transport.
 *
 * Protocol flow:
 *   1. GET /sse  →  server sends "endpoint" event with the message URL
 *   2. POST <endpoint>  initialize request
 *   3. POST <endpoint>  notifications/initialized (no response expected)
 *   4. POST <endpoint>  tools/call requests — responses arrive over SSE
 */
export class McpClient {
  private baseUrl: string;
  private messageEndpoint: string | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private endpointResolve: (() => void) | null = null;
  private endpointReject: ((e: Error) => void) | null = null;

  constructor(baseUrl = MCP_URL) {
    this.baseUrl = baseUrl;
  }

  async connect(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sse`, {
      headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
    });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to connect to MCP server: HTTP ${res.status}`);
    }

    this.reader = res.body.getReader();

    const endpointReady = new Promise<void>((resolve, reject) => {
      this.endpointResolve = resolve;
      this.endpointReject = reject;
    });

    // Consume SSE stream in background — errors propagate to pending requests
    this._consumeSse().catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.endpointReject?.(error);
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    });

    await endpointReady;

    // MCP handshake
    await this._request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "haas-chat", version: "1.0.0" },
    });
    // Notify server (fire-and-forget, no response)
    await this._post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /**
   * Fetch the tool list from the MCP server and return them in OpenAI's
   * ChatCompletionTool format so they can be passed directly to the model.
   */
  async listTools(): Promise<McpToolAsOpenAI[]> {
    const result = (await this._request("tools/list", {})) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };

    return (result?.tools ?? []).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      },
    }));
  }

  /** Call an MCP tool and return the text response as a JSON string. */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const result = (await this._request("tools/call", {
      name,
      arguments: args,
    })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    // MCP returns an array of content blocks; extract the first text block
    const text =
      result?.content?.find((c) => c.type === "text")?.text ??
      JSON.stringify(result);

    return text;
  }

  close(): void {
    try {
      this.reader?.cancel();
    } catch {
      // ignore
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _consumeSse(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let currentDataLines: string[] = [];

    const dispatch = () => {
      const event = currentEvent;
      const data = currentDataLines.join("\n");
      currentEvent = "";
      currentDataLines = [];

      if (!data) return;

      if (event === "endpoint") {
        this.messageEndpoint = data.trim();
        this.endpointResolve?.();
        this.endpointResolve = null;
        this.endpointReject = null;
        return;
      }

      if (event === "message" || event === "") {
        try {
          const msg = JSON.parse(data) as {
            id?: number;
            result?: unknown;
            error?: { message?: string };
          };
          if (msg.id !== undefined) {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              if (msg.error) {
                p.reject(
                  new Error(msg.error.message ?? JSON.stringify(msg.error))
                );
              } else {
                p.resolve(msg.result);
              }
            }
          }
        } catch {
          // ignore malformed lines
        }
      }
    };

    while (true) {
      const { done, value } = await this.reader!.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const stripped = line.replace(/\r$/, ""); // handle CRLF
        if (stripped === "") {
          dispatch();
        } else if (stripped.startsWith("event:")) {
          currentEvent = stripped.slice(6).trim();
        } else if (stripped.startsWith("data:")) {
          // Strip exactly one leading space per SSE spec
          const payload = stripped.slice(5);
          currentDataLines.push(payload.startsWith(" ") ? payload.slice(1) : payload);
        }
        // Ignore "id:" and "retry:" lines
      }
    }
  }

  private async _post(body: Record<string, unknown>): Promise<void> {
    const endpoint = this.messageEndpoint!;
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`MCP message post failed: HTTP ${res.status}`);
    }
  }

  private _request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._post({ jsonrpc: "2.0", id, method, params }).catch((err: unknown) => {
        if (this.pending.delete(id)) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }
}
