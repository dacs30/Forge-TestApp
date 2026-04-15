const MCP_URL = process.env.MCP_URL || "http://localhost:8091";
const MCP_API_KEY = process.env.HAAS_API_KEY;

const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface McpToolAsOpenAI {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Minimal MCP client using Streamable HTTP transport (spec 2025-03-26).
 *
 * Protocol flow:
 *   1. POST <endpoint>  initialize request  →  JSON or SSE response
 *   2. POST <endpoint>  notifications/initialized  →  202 Accepted
 *   3. POST <endpoint>  tools/list, tools/call, etc.  →  JSON or SSE response
 *
 * Each JSON-RPC request is a separate POST. The server may respond with
 * Content-Type: application/json (single response) or text/event-stream
 * (SSE stream that includes the response plus optional notifications).
 * Session identity is tracked via the Mcp-Session-Id header.
 */
export class McpClient {
  private endpoint: string;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(endpoint = MCP_URL) {
    this.endpoint = endpoint;
  }

  async connect(): Promise<void> {
    await withTimeout(
      this._request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "haas-chat", version: "1.0.0" },
      }),
      CONNECT_TIMEOUT_MS,
      "MCP initialize",
    );

    // Fire-and-forget notification (server returns 202)
    await this._notify("notifications/initialized");
  }

  /**
   * Fetch the tool list from the MCP server and return them in OpenAI's
   * ChatCompletionTool format so they can be passed directly to the model.
   */
  async listTools(): Promise<McpToolAsOpenAI[]> {
    const result = (await withTimeout(
      this._request("tools/list", {}),
      REQUEST_TIMEOUT_MS,
      "MCP tools/list",
    )) as {
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
    const result = (await withTimeout(
      this._request("tools/call", { name, arguments: args }),
      REQUEST_TIMEOUT_MS,
      `MCP tool call "${name}"`,
    )) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    const text =
      result?.content?.find((c) => c.type === "text")?.text ??
      JSON.stringify(result);

    return text;
  }

  /** Terminate the session. Best-effort DELETE; errors are ignored. */
  close(): void {
    if (!this.sessionId) return;
    const headers: Record<string, string> = {
      "Mcp-Session-Id": this.sessionId,
    };
    if (MCP_API_KEY) headers["Authorization"] = `Bearer ${MCP_API_KEY}`;
    fetch(this.endpoint, { method: "DELETE", headers }).catch(() => {});
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    if (MCP_API_KEY) h["Authorization"] = `Bearer ${MCP_API_KEY}`;
    return h;
  }

  /** Send a JSON-RPC notification (no id, expects 202). */
  private async _notify(method: string, params?: unknown): Promise<void> {
    const body: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) body.params = params;

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    this._captureSession(res);
    if (!res.ok) {
      throw new Error(`MCP notification "${method}" failed: HTTP ${res.status}`);
    }
  }

  /** Send a JSON-RPC request and return the result. */
  private async _request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const body = { jsonrpc: "2.0", id, method, params };

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    this._captureSession(res);

    if (!res.ok) {
      throw new Error(`MCP request "${method}" failed: HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      return this._readSseResponse(res, id);
    }

    // Plain JSON response
    const msg = (await res.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (msg.error) {
      throw new Error(msg.error.message ?? JSON.stringify(msg.error));
    }
    return msg.result;
  }

  /**
   * Read an SSE stream returned from a POST and extract the JSON-RPC
   * response matching `requestId`. The server may also send notifications
   * before the response — those are ignored for now.
   */
  private async _readSseResponse(
    res: Response,
    requestId: number
  ): Promise<unknown> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.replace(/\r$/, "");

          if (line === "") {
            // End of SSE event — dispatch
            const data = dataLines.join("\n");
            dataLines = [];
            if (!data) continue;

            try {
              const msg = JSON.parse(data) as {
                id?: number;
                result?: unknown;
                error?: { message?: string };
              };
              if (msg.id === requestId) {
                if (msg.error) {
                  throw new Error(
                    msg.error.message ?? JSON.stringify(msg.error)
                  );
                }
                return msg.result;
              }
            } catch (e) {
              // Re-throw MCP errors; ignore malformed JSON
              if (!(e instanceof SyntaxError)) throw e;
            }
          } else if (line.startsWith("data:")) {
            const payload = line.slice(5);
            dataLines.push(
              payload.startsWith(" ") ? payload.slice(1) : payload
            );
          }
          // Ignore event:, id:, retry: lines
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    throw new Error("MCP SSE stream ended without a response");
  }

  private _captureSession(res: Response): void {
    const id = res.headers.get("mcp-session-id");
    if (id) this.sessionId = id;
  }
}
