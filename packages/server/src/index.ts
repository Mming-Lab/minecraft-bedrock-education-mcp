#!/usr/bin/env node
/**
 * Entry point. Speaks MCP over stdio.
 *
 * stdio keeps the dependency surface small: the SDK's HTTP transports live in separate
 * packages (`@modelcontextprotocol/express`, `hono`, `fastify`), so not using them means
 * express and its dependency chain never enter the install at all.
 *
 * Nothing is written to stdout except protocol traffic — stdout *is* the transport. Any
 * diagnostics go to stderr.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

serveStdio(() => createServer());
