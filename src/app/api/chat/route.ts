import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { haasTools } from "@/lib/tools";
import { executeTool } from "@/lib/tool-executor";

const SYSTEM_PROMPT = `You are a helpful coding assistant with access to isolated Docker containers via HaaS (Harness-as-a-Service).

You can create ephemeral environments, execute code, read/write files, and destroy environments when done.

Workflow:
1. When a user asks you to run code, first create_environment with the right Docker image.
2. Write code files using write_file, then execute them using exec_command.
3. You can run multiple commands, inspect output, fix errors, and iterate.
4. Always destroy_environment when you're completely done.

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
- Keep responses concise. Show the code you wrote and the output you got.`;

const MAX_TOOL_ROUNDS = 15;

export async function POST(req: NextRequest) {
  const openai = new OpenAI();

  const { messages: clientMessages } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  // Build the message history for OpenAI
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...clientMessages.map(
      (m) =>
        ({
          role: m.role,
          content: m.content,
        }) as ChatCompletionMessageParam
    ),
  ];

  // Track environments created so we can clean up on error
  const activeEnvs = new Set<string>();

  try {
    // Agentic loop: call OpenAI, execute tools, repeat until text response
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages,
        tools: haasTools,
        tool_choice: "auto",
      });

      const choice = completion.choices[0];
      const assistantMessage = choice.message;

      // Add assistant message to history
      messages.push(assistantMessage as ChatCompletionMessageParam);

      // If no tool calls, we have a final text response
      if (
        !assistantMessage.tool_calls ||
        assistantMessage.tool_calls.length === 0
      ) {
        return Response.json({
          message: {
            role: "assistant",
            content: assistantMessage.content || "Done.",
          },
        });
      }

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== "function") continue;

        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args);

        // Track created environments for cleanup
        if (toolCall.function.name === "create_environment") {
          try {
            const parsed = JSON.parse(result);
            if (parsed.id) activeEnvs.add(parsed.id);
          } catch {
            // ignore parse errors
          }
        }
        if (toolCall.function.name === "destroy_environment") {
          activeEnvs.delete(args.env_id);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    // If we hit the loop limit, return what we have
    return Response.json({
      message: {
        role: "assistant",
        content:
          "I reached the maximum number of tool calls. Here's what I accomplished so far — let me know if you'd like me to continue.",
      },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Check for common issues
    let hint = "";
    if (errorMessage.includes("ECONNREFUSED")) {
      hint = "\n\nMake sure the HaaS server is running on `localhost:8080`.";
    }
    if (
      errorMessage.includes("API key") ||
      errorMessage.includes("Incorrect API key")
    ) {
      hint = "\n\nSet your `OPENAI_API_KEY` in `.env.local`.";
    }

    return Response.json({
      message: {
        role: "assistant",
        content: `**Error:** ${errorMessage}${hint}`,
      },
    });
  } finally {
    // Cleanup any environments that weren't destroyed by the agent
    const { destroyEnvironment } = await import("@/lib/haas");
    for (const envId of activeEnvs) {
      destroyEnvironment(envId).catch(() => {});
    }
  }
}
