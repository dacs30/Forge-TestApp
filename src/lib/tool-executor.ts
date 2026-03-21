import {
  createEnvironment,
  destroyEnvironment,
  execCommand,
  writeFile,
  readFile,
  listFiles,
} from "./haas";

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  console.log(`[tool-executor] Executing tool: ${name}`, JSON.stringify(args));

  try {
    let result: string;

    switch (name) {
      case "create_environment": {
        const env = await createEnvironment(args.image as string, {
          cpu: (args.cpu as number) || 0.5,
          memory_mb: (args.memory_mb as number) || 512,
          network_policy: (args.network_policy as string) || "none",
        });
        // Brief pause for container startup
        await new Promise((r) => setTimeout(r, 1000));
        result = JSON.stringify(env);
        break;
      }

      case "exec_command": {
        const execResult = await execCommand(
          args.env_id as string,
          args.command as string[],
          {
            working_dir: args.working_dir as string,
            timeout_seconds: (args.timeout_seconds as number) || 30,
          }
        );
        result = JSON.stringify(execResult);
        break;
      }

      case "write_file": {
        await writeFile(
          args.env_id as string,
          args.path as string,
          args.content as string
        );
        result = JSON.stringify({ success: true, path: args.path });
        break;
      }

      case "read_file": {
        const content = await readFile(
          args.env_id as string,
          args.path as string
        );
        result = JSON.stringify({ path: args.path, content });
        break;
      }

      case "list_files": {
        const files = await listFiles(
          args.env_id as string,
          (args.path as string) || "/"
        );
        result = JSON.stringify(files);
        break;
      }

      case "offer_download": {
        // Verify the file exists by reading its first bytes
        const envIdForDownload = args.env_id as string;
        const filePath = args.path as string;
        const fileName =
          (args.filename as string) || filePath.split("/").pop() || "download";
        const description = (args.description as string) || "";

        // Build the proxy download URL
        const downloadUrl = `/api/files/download?env_id=${encodeURIComponent(envIdForDownload)}&path=${encodeURIComponent(filePath)}`;

        result = JSON.stringify({
          success: true,
          download_url: downloadUrl,
          filename: fileName,
          description,
        });
        break;
      }

      case "destroy_environment": {
        await destroyEnvironment(args.env_id as string);
        result = JSON.stringify({
          success: true,
          message: "Environment destroyed",
        });
        break;
      }

      default:
        result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    console.log(`[tool-executor] Tool ${name} response:`, result);
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[tool-executor] Tool ${name} error:`, message);
    return JSON.stringify({ error: message });
  }
}
