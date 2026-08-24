/**
 * Builds the MCP server and registers the tool surface.
 *
 * The tools themselves are plain data (see `tools/types.ts`); this is the only file that
 * knows the SDK exists. That boundary is why the whole surface can be tested without an MCP
 * client, and why swapping transports later touches nothing else.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { allTools, offlineBridge, toolsFor, type WorldBridge } from './tools/index.js';
import { InvalidArgumentError } from './geometry/index.js';

const NAME = '@mming-lab/minecraft-bedrock-education-mcp';
const VERSION = '0.1.0';

/**
 * Wraps a tool's pure handler into the shape the SDK expects.
 *
 * Two things happen here that the spec asks for and the previous server did neither of:
 *
 * - the result is returned as `structuredContent` *and* serialised into a text block, since
 *   clients that predate structured output only read the latter;
 * - a failure comes back as a tool execution error (`isError: true`) rather than a thrown
 *   protocol error, because the spec reserves protocol errors for malformed requests and
 *   says clients should hand execution errors to the model so it can correct itself.
 *
 * An `InvalidArgumentError` is exactly that kind of correctable failure: it names the
 * parameter and says what was wrong with it, so the next attempt has somewhere to go.
 */
function toCallback(handler: (args: never) => unknown) {
  // Async because the world tools are: a region read is a round trip through the game, and
  // several seconds of it. Awaiting a synchronous handler's plain value costs nothing, so
  // both kinds go through the same path rather than the surface splitting in two.
  return async (args: unknown) => {
    try {
      const result = await handler(args as never);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      const message =
        error instanceof InvalidArgumentError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);

      return {
        content: [{ type: 'text' as const, text: message }],
        isError: true,
      };
    }
  };
}

export interface ServerOptions {
  /**
   * The connection to the game, for the `world.*` tools.
   *
   * Optional, and its absence changes the tool list not at all - an unbound server registers
   * the same tools and answers a call to one of them by saying how to connect. A surface that
   * shrank when nobody was connected would have the model conclude the server cannot read,
   * which is a different problem from the one it has.
   */
  bridge?: WorldBridge;
}

/**
 * Creates a server with every tool registered.
 *
 * Called once per connection: `serveStdio` takes a factory rather than an instance, so each
 * connection gets its own registration state. The bridge is *not* created here, because there
 * is one socket for the whole process and each MCP client shares it.
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });

  // Registered in the order `toolsFor` declares, which is grouped by prefix. The spec asks
  // for a deterministic `tools/list` because it lets clients cache the list and improves
  // prompt-cache hit rates on the model side.
  for (const tool of toolsFor(options.bridge ?? offlineBridge)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      toCallback(tool.handler) as never
    );
  }

  return server;
}

/** Exposed for tests, which assert against the registered surface rather than the source. */
export const registeredToolNames: readonly string[] = allTools.map((t) => t.name);

export { z };
