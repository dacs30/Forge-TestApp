"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface TerminalProps {
  envId: string;
  onClose: () => void;
}

// Dynamically import xterm so it's never bundled for SSR
async function loadXterm() {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("xterm"),
    import("xterm-addon-fit"),
  ]);
  return { Terminal, FitAddon };
}

export default function Terminal({ envId, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("xterm").Terminal | null>(null);
  const fitRef = useRef<import("xterm-addon-fit").FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "exited" | "error">("connecting");
  const [exitCode, setExitCode] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const focusTerminal = useCallback(() => {
    termRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let term: import("xterm").Terminal;
    let fit: import("xterm-addon-fit").FitAddon;
    let ws: WebSocket;
    let ro: ResizeObserver;

    loadXterm().then(({ Terminal: XTerm, FitAddon }) => {
      if (disposed) return;

      term = new XTerm({
        theme: {
          background: "#18181b",
          foreground: "#e4e4e7",
          cursor: "#a1a1aa",
          selectionBackground: "#3f3f46",
        },
        fontFamily: '"Fira Code", "Cascadia Code", monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
      });

      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current!);
      fit.fit();
      term.focus();

      termRef.current = term;
      fitRef.current = fit;

      // Track focus via DOM events (xterm 5 doesn't expose onFocus/onBlur)
      const onFocusIn = () => setFocused(true);
      const onFocusOut = () => setFocused(false);
      containerRef.current!.addEventListener("focusin", onFocusIn);
      containerRef.current!.addEventListener("focusout", onFocusOut);

      // Connect to the local WS proxy
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/api/ws/terminal/${encodeURIComponent(envId)}?cmd=bash`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) { ws.close(); return; }
        setStatus("open");
        const dims = fit.proposeDimensions();
        if (dims) sendResize(dims.cols, dims.rows);
      };

      ws.onmessage = (evt) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(evt.data as string) as {
            stream: "output" | "exit" | "error";
            data: string;
          };
          if (msg.stream === "output") {
            term.write(msg.data);
          } else if (msg.stream === "exit") {
            setExitCode(msg.data);
            setStatus("exited");
            term.write(`\r\n\x1b[33m[Process exited with code ${msg.data}]\x1b[0m\r\n`);
            term.options.disableStdin = true;
          } else if (msg.stream === "error") {
            setStatus("error");
            term.write(`\r\n\x1b[31m[Error: ${msg.data}]\x1b[0m\r\n`);
            term.options.disableStdin = true;
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!disposed) setStatus("error");
      };

      ws.onclose = () => {
        if (!disposed) setStatus((prev) => (prev === "exited" ? "exited" : "error"));
      };

      // Forward keystrokes / paste to the WebSocket
      term.onData((data) => {
        console.log(`[terminal] onData fired, ws.readyState=${ws.readyState}, data=${JSON.stringify(data)}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Resize observer — kept in outer scope so cleanup can disconnect it
      ro = new ResizeObserver(() => {
        if (!containerRef.current) return;
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims) sendResize(dims.cols, dims.rows);
      });
      ro.observe(containerRef.current!);
    });

    return () => {
      disposed = true;
      ro?.disconnect();
      ws?.close();
      term?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId]);

  const statusColor =
    status === "open"
      ? "bg-green-500"
      : status === "exited"
      ? "bg-yellow-500"
      : status === "error"
      ? "bg-red-500"
      : "bg-zinc-500 animate-pulse";

  const statusLabel =
    status === "connecting"
      ? "Connecting…"
      : status === "open"
      ? "Connected"
      : status === "exited"
      ? `Exited (${exitCode ?? "?"})`
      : "Error";

  return (
    <div className="flex flex-col border-t border-zinc-700 bg-[#18181b]" style={{ height: "320px" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700 bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="font-mono">{envId}</span>
          <span className="text-zinc-600">·</span>
          <span>{statusLabel}</span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 transition-colors text-sm px-2 py-0.5 rounded hover:bg-zinc-700"
          aria-label="Close terminal"
        >
          ✕
        </button>
      </div>

      {/* xterm.js mount point */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={containerRef} className="absolute inset-0 p-1" onClick={focusTerminal} />
        {/* Focus hint — shown when connected but terminal doesn't have focus */}
        {status === "open" && !focused && (
          <div
            onClick={focusTerminal}
            className="absolute inset-0 flex items-center justify-center cursor-text"
            style={{ background: "transparent" }}
          >
            <span className="text-xs text-zinc-500 bg-zinc-900/80 px-2 py-1 rounded pointer-events-none">
              Click to type
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
