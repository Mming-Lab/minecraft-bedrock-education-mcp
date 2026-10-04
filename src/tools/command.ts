/**
 * The escape hatch: one command line, sent as written.
 *
 * The rewrite dropped this on purpose. The legacy server carried `run_command` as one action
 * of its `world` tool, and it was the reason the rest of that surface could not be trusted -
 * a model that can write any command line writes one instead of calling the tool built for
 * the job, and the command line is where the interesting failures lived. A block id of
 * `air 0 destroy` turned a replace fill into a destroy and the reply still said replace.
 * Every schema in `types.ts` exists because of that.
 *
 * Leaving it out altogether turned out to be the wrong correction. Bedrock has several
 * hundred commands and this server implements a dozen of them, so handing a class a pickaxe,
 * setting the time to noon or stopping the rain had no route at all, and the honest answer to
 * those was "this server cannot" - which is a worse outcome than the risk it was avoiding.
 *
 * So it comes back with the shape it should have had the first time: its own tool rather than
 * an action hidden inside `world`, marked as changing the world, described as the last resort
 * rather than the general one, and taking a single line that is checked before it is sent.
 *
 * ## What is deliberately not checked
 *
 * What the command *does*. An allow-list would have to be wrong in one of two directions -
 * short enough to block the lesson, or long enough to be no protection - and the person at
 * the keyboard is the one who can tell which command they meant. What is checked is that the
 * argument is one line of a command, so a caller who assembled the string wrong finds out
 * here rather than by watching half of it reach the game.
 */

import { z } from 'zod';
import type { CommandRunner } from '../bridge/index.js';
import { defineTool, type AnyToolDefinition } from './types.js';

/**
 * One command line, and nothing that could be two.
 *
 * The whole control range goes, rather than a line break alone: the string reaches socket-be
 * unexamined and is put straight into the packet, so this is the last place that looks at it.
 * Not because a smuggled second command is known to get through - it is not - but because
 * every value in that range means the caller assembled the string wrong, and finding that out
 * here beats finding it out from a half-delivered command.
 */
const CommandLine = z
  .string()
  .trim()
  .min(1, 'a command line, such as "time set noon"')
  .regex(
    /^[^\u0000-\u001f\u007f]+$/,
    'a command is a single line — no line breaks or control characters'
  )
  .describe(
    'The command, written as it would be typed in chat. The leading slash is optional. ' +
      'Examples: "time set noon", "give @a diamond_pickaxe 1", "effect @p night_vision 30 1".'
  );

export const worldRunCommandTool = (runner: CommandRunner) =>
  defineTool({
    name: 'world.run_command',
    title: 'Run one Minecraft command',
    description: [
      'Send a single Minecraft command to the connected world, exactly as it would be typed in chat, and return what the game said about it.',
      'This is the last resort, not the general route. It is here because this server implements a dozen of Bedrock’s several hundred commands, so giving out items, setting the time, changing the weather, summoning, granting effects and running scoreboards have no tool of their own.',
      'Do NOT use it to place or read blocks. The build tools pack a shape into the fewest fills and report what was placed, and world.read_region and world.get_block report block states in a form that does not depend on the client’s language; a hand-written setblock or fill gives up all of that and is far slower for anything past a handful of blocks.',
      'Do NOT use it to find the players either — world.players already does, and answers with positions rather than a sentence to parse.',
      'It changes the world, cannot be undone, and runs with whatever permissions the connection has.',
      'A negative statusCode does not mean the command was refused: "0 blocks filled" is negative and describes a fill that ran. Read the code and the message together.',
    ].join(' '),
    inputSchema: { command: CommandLine },
    outputSchema: {
      command: z.string().describe('The line as it was sent, after any leading slash was removed.'),
      statusCode: z
        .number()
        .int()
        .describe('Bedrock’s own code, passed through unjudged. Negative is not the same as refused.'),
      statusMessage: z
        .string()
        .describe(
          'What the game said, in the client’s language — a Japanese client answers in Japanese, so decide from the code rather than by matching this text.'
        ),
      data: z
        .record(z.string(), z.unknown())
        .describe(
          'Everything else the game returned, unaltered. Most commands add nothing; the ones that carry their answer in a field of their own put it here — querytarget puts a JSON array in "details".'
        ),
    },
    // Not idempotent and not read-only, whatever the command happens to be: an annotation
    // describes the tool, and this tool cannot know what it was handed.
    annotations: { destructiveHint: true },
    handler: async (args) => {
      // A leading slash is how a command is typed in chat and not how it goes on the wire -
      // socket-be puts the string straight into the packet's commandLine, and every call
      // inside socket-be itself omits it. Stripped rather than refused: which of the two forms
      // a model writes is a coin flip, and rejecting one of them teaches nobody anything.
      const commandLine = args.command.replace(/^\/+/, '').trim();
      if (commandLine === '') throw new Error('the command was nothing but slashes');

      const outcome = await runner.run(commandLine);
      return {
        command: outcome.commandLine,
        statusCode: outcome.statusCode,
        statusMessage: outcome.statusMessage,
        data: outcome.data,
      };
    },
  });

export function commandTools(runner: CommandRunner): AnyToolDefinition[] {
  return [worldRunCommandTool(runner)] as unknown as AnyToolDefinition[];
}
