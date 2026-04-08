# HaaS Chat

An AI chat assistant that can write, execute, and iterate on code inside isolated Docker containers using [HaaS (Harness-as-a-Service)](https://github.com/dacs30/Forge-Agent-Harness-API).

Built with Next.js and OpenAI as the model provider.

![Demo](demo.gif)

## Features

- **Sandboxed code execution** — spins up ephemeral Docker containers (Python, Node, Go, Rust, Ruby, Alpine) on demand
- **Agentic tool loop** — the AI creates environments, writes files, runs commands, reads output, and iterates automatically
- **File downloads** — generates files (Excel, PDF, images, etc.) inside containers and offers them for download
- **Streaming UI** — real-time tool activity and responses streamed to the browser via NDJSON
- **Persistent environments** — containers stay alive across messages so users can continue working
- **HTTP or MCP transport** — switch between direct HaaS HTTP calls and an MCP server with a single toggle

## Transport modes

| Mode | How it works |
|------|-------------|
| **HTTP** (default) | The Next.js server calls the HaaS REST API directly. Tools are defined locally. |
| **MCP** | The Next.js server connects to an MCP server over SSE (`localhost:8091`). Tool schemas and execution are fully owned by the MCP server — no local tool definitions are used. |

Use the **HTTP / MCP** toggle in the bottom-right corner of the chat to switch modes. The toggle is per-session and takes effect on the next message.

## Getting Started

1. **Start the HaaS server** on `localhost:8080` (or set `HAAS_URL`)

2. *(MCP mode only)* **Start the MCP server** on `localhost:8091` (or set `MCP_URL`)

3. **Configure environment variables** — create `.env.local`:
   ```
   OPENAI_API_KEY=sk-...
   HAAS_URL=http://localhost:8080   # optional, default for HTTP mode
   HAAS_API_KEY=your-haas-key       # optional, sent as Bearer token to HaaS
   OPENAI_MODEL=gpt-4o              # optional, defaults to gpt-4o
   MCP_URL=http://localhost:8091    # optional, default for MCP mode
   ```

4. **Install and run:**
   ```bash
   npm install
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)
