import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { haasTools } from "@/lib/tools";
import { executeTool } from "@/lib/tool-executor";
import { McpClient, type McpToolAsOpenAI } from "@/lib/mcp-client";

const SYSTEM_PROMPT = `You are a helpful coding assistant with access to isolated Docker containers via HaaS (Harness-as-a-Service).

You can create ephemeral environments, execute code, read/write files, and destroy environments.

Workflow:
1. If you are given an active environment ID, REUSE it — do NOT create a new one unless the user asks for a different language/image or the environment has been destroyed.
2. If no environment exists yet, create one with create_environment.
3. Write code files using write_file, then execute them using exec_command.
4. You can run multiple commands, inspect output, fix errors, and iterate.
5. Do NOT destroy the environment unless the user explicitly asks to clean up or start fresh. The environment persists across messages so the user can continue working.

Available images:
- python:3.11-slim — Python
- node:20-slim — Node.js / JavaScript / TypeScript
- alpine:latest — Shell scripting, general CLI tools
- golang:1.22-alpine — Go
- ruby:3.3-slim — Ruby
- rust:1.77-slim — Rust (compile + run)

Tips:
- For Python: write to /workspace/main.py, run with ["python", "/workspace/main.py"]
- For Node: write to /workspace/main.js, run with ["node", "/workspace/main.js"]
- For shell: use ["sh", "-c", "your command here"]
- You can install packages: ["sh", "-c", "pip install requests"] or ["sh", "-c", "npm install lodash"]
- If a command fails, read the error, fix the code, and retry.
- Keep responses concise. Show the code you wrote and the output you got.
- Files and installed packages persist in the environment between messages.

File Generation:
- You can generate Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF, CSV, images, and any other file type.
- For Office files in Python: pip install openpyxl python-docx python-pptx
- After generating a file, ALWAYS call offer_download so the user can download it.
- Example flow: exec pip install → write script → exec script → offer_download the output file.`;

const MAX_TOOL_ROUNDS = 15;

// Friendly labels for tool calls
function toolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "create_environment":
      return `Creating container (${args.image})`;
    case "exec_command": {
      const cmd = args.command as string[];
      const display = cmd.length <= 3 ? cmd.join(" ") : cmd.slice(0, 3).join(" ") + "...";
      return `Running: ${display}`;
    }
    case "write_file":
      return `Writing ${args.path}`;
    case "read_file":
      return `Reading ${args.path}`;
    case "list_files":
      return `Listing ${args.path || "/"}`;
    case "offer_download":
      return `Preparing download: ${args.filename || (args.path as string).split("/").pop()}`;
    case "destroy_environment":
      return `Destroying environment`;
    default:
      return name;
  }
}

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 50_000;
const ENV_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function POST(req: NextRequest) {
  const openai = new OpenAI();

  const { messages: clientMessages, envId: currentEnvId, mode } =
    (await req.json()) as {
      messages: { role: "user" | "assistant"; content: string }[];
      envId?: string;
      mode?: "http" | "mcp";
    };

  const useMcp = mode === "mcp";

  // Input validation
  if (!Array.isArray(clientMessages) || clientMessages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }
  if (clientMessages.length > MAX_MESSAGES) {
    return Response.json(
      { error: `Too many messages (max ${MAX_MESSAGES})` },
      { status: 400 }
    );
  }
  for (const m of clientMessages) {
    if (!m.role || !m.content || typeof m.content !== "string") {
      return Response.json({ error: "Invalid message format" }, { status: 400 });
    }
    if (m.content.length > MAX_MESSAGE_LENGTH) {
      return Response.json(
        { error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` },
        { status: 400 }
      );
    }
  }
  if (currentEnvId && !ENV_ID_PATTERN.test(currentEnvId)) {
    return Response.json({ error: "Invalid envId format" }, { status: 400 });
  }

  let systemPrompt = SYSTEM_PROMPT;
  if (currentEnvId) {
    systemPrompt += `\n\nACTIVE ENVIRONMENT: ${currentEnvId} — reuse this for commands and file operations. Do not create a new environment unless the user needs a different image.`;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...clientMessages.map(
      (m) =>
        ({
          role: m.role,
          content: m.content,
        }) as ChatCompletionMessageParam
    ),
  ];

  let activeEnvId = currentEnvId || null;

  // Stream NDJSON events to the client
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }

      let mcpClient: McpClient | null = null;
      let activeTools: typeof haasTools | McpToolAsOpenAI[] = haasTools;

      if (useMcp) {
        try {
          mcpClient = new McpClient();
          await mcpClient.connect();
          activeTools = await mcpClient.listTools();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          send({
            type: "message",
            content: `**Error connecting to MCP server:** ${msg}\n\nMake sure the MCP server is running on \`localhost:8091\`.`,
            envId: activeEnvId,
          });
          controller.close();
          return;
        }
      }

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o",
            messages,
            tools: activeTools,
            tool_choice: "auto",
          });

          const choice = completion.choices[0];
          const assistantMessage = choice.message;
          messages.push(assistantMessage as ChatCompletionMessageParam);

          // No tool calls — send final message
          if (
            !assistantMessage.tool_calls ||
            assistantMessage.tool_calls.length === 0
          ) {
            send({
              type: "message",
              content: assistantMessage.content || "Done.",
              envId: activeEnvId,
            });
            controller.close();
            return;
          }

          // Execute each tool call and stream events
          for (const toolCall of assistantMessage.tool_calls) {
            if (toolCall.type !== "function") continue;

            const args = JSON.parse(toolCall.function.arguments);
            const label = toolLabel(toolCall.function.name, args);

            // Send tool_start event
            send({
              type: "tool_start",
              tool: toolCall.function.name,
              label,
              args,
            });

            const result = mcpClient
              ? await mcpClient.callTool(toolCall.function.name, args)
              : await executeTool(toolCall.function.name, args);

            // Track active environment
            if (toolCall.function.name.endsWith("create_environment")) {
              // Extract env ID from JSON (HTTP mode) or plain text (MCP mode)
              let extractedId: string | null = null;
              try {
                const parsed = JSON.parse(result);
                extractedId = parsed.id ?? parsed.env_id ?? parsed.environment_id ?? null;
              } catch {
                // MCP servers often return plain text like "ID: env_abc123"
                const idMatch = result.match(/\bID:\s*(\S+)/i)
                  ?? result.match(/\b(env_[a-zA-Z0-9_-]+)/);
                if (idMatch) extractedId = idMatch[1];
              }

              if (extractedId) {
                activeEnvId = String(extractedId);
                // Fix up any remaining batched tool calls that reference a stale env_id
                for (const laterCall of assistantMessage.tool_calls!) {
                  if (laterCall.type !== "function") continue;
                  try {
                    const laterArgs = JSON.parse(laterCall.function.arguments);
                    if (laterArgs.env_id && laterArgs.env_id !== activeEnvId) {
                      laterArgs.env_id = activeEnvId;
                      laterCall.function.arguments = JSON.stringify(laterArgs);
                    }
                  } catch {
                    // ignore unparseable args
                  }
                }
              }
            }
            if (toolCall.function.name.endsWith("destroy_environment")) {
              if (args.env_id === activeEnvId) {
                activeEnvId = null;
              }
            }

            // Parse result for display
            let resultSummary: string;
            try {
              const parsed = JSON.parse(result);
              if (parsed.error) {
                resultSummary = `Error: ${parsed.error}`;
              } else if (toolCall.function.name === "exec_command") {
                const output = (parsed.stdout || "") + (parsed.stderr || "");
                resultSummary = output.length > 200
                  ? output.slice(0, 200) + "..."
                  : output || "(no output)";
                if (parsed.exitCode && parsed.exitCode !== "0") {
                  resultSummary += ` (exit ${parsed.exitCode})`;
                }
              } else if (toolCall.function.name === "create_environment") {
                resultSummary = `Created ${parsed.id}`;
              } else if (toolCall.function.name === "read_file") {
                const content = parsed.content || "";
                resultSummary = content.length > 200
                  ? content.slice(0, 200) + "..."
                  : content;
              } else if (parsed.success) {
                resultSummary = "Success";
              } else {
                resultSummary = result.length > 200 ? result.slice(0, 200) + "..." : result;
              }
            } catch {
              resultSummary = result.length > 200 ? result.slice(0, 200) + "..." : result;
            }

            // Send tool_result event
            send({
              type: "tool_result",
              tool: toolCall.function.name,
              label,
              result: resultSummary,
            });

            // If this was offer_download, send a file_download event for the UI
            if (toolCall.function.name === "offer_download") {
              try {
                const parsed = JSON.parse(result);
                if (parsed.success && parsed.download_url) {
                  send({
                    type: "file_download",
                    url: parsed.download_url,
                    filename: parsed.filename,
                    description: parsed.description,
                  });
                }
              } catch {
                // ignore
              }
            }

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result,
            });
          }
        }

        send({
          type: "message",
          content:
            "I reached the maximum number of tool calls. Let me know if you'd like me to continue.",
          envId: activeEnvId,
        });
        controller.close();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        let hint = "";
        if (errorMessage.includes("ECONNREFUSED")) {
          hint = useMcp
            ? "\n\nMake sure the MCP server is running on `localhost:8091`."
            : "\n\nMake sure the HaaS server is running on `localhost:8080`.";
        }
        if (
          errorMessage.includes("API key") ||
          errorMessage.includes("Incorrect API key")
        ) {
          hint = "\n\nSet your `OPENAI_API_KEY` in `.env.local`.";
        }

        send({
          type: "message",
          content: `**Error:** ${errorMessage}${hint}`,
          envId: activeEnvId,
        });
        controller.close();
      } finally {
        mcpClient?.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}
