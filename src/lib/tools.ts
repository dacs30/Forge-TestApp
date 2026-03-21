import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const haasTools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_environment",
      description:
        "Create an isolated Docker container environment for running code. Returns an environment ID. You must create an environment before executing commands or writing files.",
      parameters: {
        type: "object",
        properties: {
          image: {
            type: "string",
            description:
              'Docker image to use, e.g. "python:3.11-slim", "node:20-slim", "alpine:latest"',
          },
          cpu: {
            type: "number",
            description: "CPU cores (0.1-4). Default: 0.5",
          },
          memory_mb: {
            type: "number",
            description: "Memory in MB (128-8192). Default: 512",
          },
          network_policy: {
            type: "string",
            enum: ["none", "egress-limited", "full"],
            description:
              'Network access policy. "none" = no network, "full" = unrestricted. Default: "none"',
          },
        },
        required: ["image"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec_command",
      description:
        "Execute a shell command inside a running environment. Returns stdout, stderr, and exit code. The environment must already be created.",
      parameters: {
        type: "object",
        properties: {
          env_id: {
            type: "string",
            description: "The environment ID returned from create_environment",
          },
          command: {
            type: "array",
            items: { type: "string" },
            description:
              'Command as array of strings, e.g. ["python", "main.py"] or ["sh", "-c", "echo hello"]',
          },
          working_dir: {
            type: "string",
            description: "Working directory inside the container. Default: /",
          },
          timeout_seconds: {
            type: "number",
            description: "Timeout in seconds. Default: 30",
          },
        },
        required: ["env_id", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write content to a file inside a running environment. Creates parent directories automatically.",
      parameters: {
        type: "object",
        properties: {
          env_id: {
            type: "string",
            description: "The environment ID",
          },
          path: {
            type: "string",
            description:
              "Absolute file path inside the container, e.g. /workspace/main.py",
          },
          content: {
            type: "string",
            description: "File content to write",
          },
        },
        required: ["env_id", "path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file inside a running environment.",
      parameters: {
        type: "object",
        properties: {
          env_id: {
            type: "string",
            description: "The environment ID",
          },
          path: {
            type: "string",
            description: "Absolute file path inside the container",
          },
        },
        required: ["env_id", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files and directories at a given path inside a running environment.",
      parameters: {
        type: "object",
        properties: {
          env_id: {
            type: "string",
            description: "The environment ID",
          },
          path: {
            type: "string",
            description: "Directory path to list. Default: /",
          },
        },
        required: ["env_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "destroy_environment",
      description:
        "Destroy an environment and its container. Always clean up when done.",
      parameters: {
        type: "object",
        properties: {
          env_id: {
            type: "string",
            description: "The environment ID to destroy",
          },
        },
        required: ["env_id"],
      },
    },
  },
];
