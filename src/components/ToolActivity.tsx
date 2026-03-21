"use client";

import { useState } from "react";

export interface ToolEvent {
  type: "tool_start" | "tool_result";
  tool: string;
  label: string;
  args?: Record<string, unknown>;
  result?: string;
}

// Icons for each tool type
function ToolIcon({ tool }: { tool: string }) {
  switch (tool) {
    case "create_environment":
      return <span className="text-green-400">+</span>;
    case "destroy_environment":
      return <span className="text-red-400">x</span>;
    case "exec_command":
      return <span className="text-yellow-400">&gt;</span>;
    case "write_file":
      return <span className="text-blue-400">&darr;</span>;
    case "read_file":
      return <span className="text-purple-400">&uarr;</span>;
    case "list_files":
      return <span className="text-cyan-400">#</span>;
    default:
      return <span className="text-zinc-400">?</span>;
  }
}

function ToolStep({
  event,
  isLast,
}: {
  event: ToolEvent;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = event.type === "tool_result";

  return (
    <div className="flex gap-2 items-start">
      {/* Timeline connector */}
      <div className="flex flex-col items-center w-5 shrink-0">
        <div className="w-5 h-5 rounded-full border border-zinc-600 bg-zinc-800 flex items-center justify-center text-xs">
          {isComplete ? (
            <ToolIcon tool={event.tool} />
          ) : (
            <span className="w-2 h-2 border border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
          )}
        </div>
        {!isLast && <div className="w-px h-full bg-zinc-700 min-h-[12px]" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-2 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors text-left w-full"
        >
          <span className="font-medium text-zinc-300">{event.label}</span>
          {isComplete && event.result && (
            <span className="ml-1 text-zinc-500">
              {expanded ? "▾" : "▸"}
            </span>
          )}
        </button>

        {expanded && isComplete && event.result && (
          <pre className="mt-1 text-xs text-zinc-500 bg-zinc-900/50 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">
            {event.result}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function ToolActivity({ events }: { events: ToolEvent[] }) {
  if (events.length === 0) return null;

  // Collapse start/result pairs into result-only events
  const collapsed: ToolEvent[] = [];
  const pending = new Map<string, number>();

  for (const event of events) {
    const key = event.tool + ":" + event.label;
    if (event.type === "tool_start") {
      pending.set(key, collapsed.length);
      collapsed.push(event);
    } else if (event.type === "tool_result") {
      const idx = pending.get(key);
      if (idx !== undefined) {
        // Replace start with result
        collapsed[idx] = event;
        pending.delete(key);
      } else {
        collapsed.push(event);
      }
    }
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[80%] bg-zinc-800/50 border border-zinc-700/50 rounded-2xl px-4 py-3">
        <div className="text-xs font-medium mb-2 text-zinc-500">
          Container Activity
        </div>
        <div>
          {collapsed.map((event, i) => (
            <ToolStep
              key={i}
              event={event}
              isLast={i === collapsed.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
