"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import ToolActivity, { type ToolEvent } from "./ToolActivity";
import FileDownload, { type FileDownloadData } from "./FileDownload";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatEntry {
  type: "message" | "tools" | "file";
  message?: Message;
  toolEvents?: ToolEvent[];
  file?: FileDownloadData;
}

export default function Chat() {
  const [entries, setEntries] = useState<ChatEntry[]>([
    {
      type: "message",
      message: {
        role: "assistant",
        content: `Welcome! I'm an AI assistant with access to **isolated Docker containers**.

I can write code, execute it, inspect results, install packages, and iterate — all in sandboxed environments that persist across messages.

Try asking me things like:
- "Write a Python script that generates the first 20 Fibonacci numbers"
- "Create a Node.js HTTP server and test it with curl"
- "Run \`uname -a\` in an Alpine container"
- "Write and run a Go program that prints prime numbers under 100"`,
      },
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [envId, setEnvId] = useState<string | null>(null);
  const [currentToolEvents, setCurrentToolEvents] = useState<ToolEvent[]>([]);
  const [mode, setMode] = useState<"http" | "mcp">("http");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, currentToolEvents]);

  const handleSend = useCallback(
    async (content: string) => {
      const userMessage: Message = { role: "user", content };

      // Collect all previous assistant/user messages for context
      const allMessages = entries
        .filter((e) => e.type === "message" && e.message)
        .map((e) => e.message!);
      const updatedMessages = [...allMessages, userMessage];

      setEntries((prev) => [
        ...prev,
        { type: "message", message: userMessage },
      ]);
      setLoading(true);
      setCurrentToolEvents([]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedMessages,
            envId,
            mode,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        // Read NDJSON stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const toolEvents: ToolEvent[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);

              if (event.type === "tool_start" || event.type === "tool_result") {
                toolEvents.push(event as ToolEvent);
                setCurrentToolEvents([...toolEvents]);
              } else if (event.type === "file_download") {
                // Add file download card inline
                setEntries((prev) => [
                  ...prev,
                  {
                    type: "file",
                    file: {
                      url: event.url,
                      filename: event.filename,
                      description: event.description,
                    },
                  },
                ]);
              } else if (event.type === "message") {
                // Finalize: add tool events block + assistant message
                setCurrentToolEvents([]);

                setEntries((prev) => {
                  const next = [...prev];
                  if (toolEvents.length > 0) {
                    next.push({ type: "tools", toolEvents: [...toolEvents] });
                  }
                  next.push({
                    type: "message",
                    message: { role: "assistant", content: event.content },
                  });
                  return next;
                });

                if (event.envId !== undefined) {
                  setEnvId(event.envId);
                }
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch {
        setCurrentToolEvents([]);
        setEntries((prev) => [
          ...prev,
          {
            type: "message",
            message: {
              role: "assistant",
              content:
                "**Error:** Could not reach the chat API. Is the Next.js server running?",
            },
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [entries, envId]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {entries.map((entry, i) => {
            if (entry.type === "message" && entry.message) {
              return (
                <ChatMessage
                  key={i}
                  role={entry.message.role}
                  content={entry.message.content}
                />
              );
            }
            if (entry.type === "tools" && entry.toolEvents) {
              return (
                <ToolActivity key={i} events={entry.toolEvents} />
              );
            }
            if (entry.type === "file" && entry.file) {
              return <FileDownload key={i} file={entry.file} />;
            }
            return null;
          })}

          {/* Live tool activity while loading */}
          {loading && currentToolEvents.length > 0 && (
            <ToolActivity events={currentToolEvents} />
          )}

          {loading && currentToolEvents.length === 0 && (
            <div className="flex justify-start mb-4">
              <div className="bg-zinc-800 border border-zinc-700 rounded-2xl px-4 py-3">
                <div className="text-xs font-medium mb-1 opacity-70">
                  HaaS Bot
                </div>
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                  Thinking...
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input + env indicator */}
      <div className="border-t border-zinc-800 bg-zinc-950/50 backdrop-blur-sm px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            {envId ? (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                Environment active: {envId}
              </div>
            ) : (
              <div />
            )}
            {/* Transport mode toggle */}
            <div className="flex items-center gap-1 rounded-lg bg-zinc-800 p-0.5 text-xs font-medium">
              <button
                onClick={() => setMode("http")}
                disabled={loading}
                className={`px-3 py-1 rounded-md transition-colors ${
                  mode === "http"
                    ? "bg-zinc-600 text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                HTTP
              </button>
              <button
                onClick={() => setMode("mcp")}
                disabled={loading}
                className={`px-3 py-1 rounded-md transition-colors ${
                  mode === "mcp"
                    ? "bg-zinc-600 text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                MCP
              </button>
            </div>
          </div>
          <ChatInput onSend={handleSend} disabled={loading} />
        </div>
      </div>
    </div>
  );
}
