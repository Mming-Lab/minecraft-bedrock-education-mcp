/**
 * The wire format between this server and the add-on running inside Minecraft.
 *
 * Requests leave as a command on the WebSocket the server already holds:
 *
 *     scriptevent mcp:getblock a7 {"x":2,"y":-55,"z":-1}
 *
 * Replies come back as chat, because that is the only thing a script can say that reaches the
 * socket. `world.sendMessage` shows in the game and fires nothing; `player.runCommand('say
 * ...')` fires PlayerMessage, which is a *player* event and does. Three sessions went into
 * finding that, and it is why every reply here arrives wearing a player's name:
 *
 *     [Kai_U] MCPB|a7|{"ok":true,"name":"minecraft:stone","states":{...}}
 *
 * ## Why anything is split at all
 *
 * A chat line is capped. Measured on Education Edition 1.26.3200: 481 characters arrive, 487
 * arrive not at all - the whole line vanishes rather than being truncated, which is the
 * dangerous kind of limit because a silent drop looks like a shorter answer. Two hundred
 * lines in a burst lost nothing, so the ceiling is length, not count.
 *
 * A long answer is therefore a header naming how many parts follow, then the parts:
 *
 *     [Kai_U] MCPB|r|{"ok":true,"total":4096,"parts":171,...}
 *     [Kai_U] MCPB|r.0|{"part":0,"blocks":[...]}
 *     [Kai_U] MCPB|r.1|{"part":1,"blocks":[...]}
 *
 * The header's count is what makes a lost line detectable. Without it a reply that dropped
 * its last part would look complete, and the model would be told about a region it had only
 * partly seen.
 */

/** Everything the add-on sends is prefixed with this, so ordinary chat can be ignored cheaply. */
export const BRIDGE_TAG = 'MCPB';

/**
 * The longest line that survives the trip.
 *
 * 481 arrived and 487 did not, so the true limit is somewhere between; 460 leaves room for
 * the `[playername] MCPB|<id>.<n>|` wrapper without having to know a player's name in
 * advance. Being wrong here is expensive - an over-long line is dropped in full - so the
 * margin is deliberate rather than tuned.
 */
export const MAX_LINE = 460;

export interface BridgeRequest {
  readonly action: string;
  readonly id: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** A reply line, once the chat wrapper is off. */
export interface BridgeLine {
  readonly id: string;
  /** Present when this is one part of a split answer. */
  readonly part: number | null;
  readonly payload: unknown;
}

export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeProtocolError';
  }
}

const ID_PATTERN = /^[a-z0-9]{1,12}$/;

/**
 * Builds the command that carries a request.
 *
 * The id goes before the JSON so that a malformed body can still be answered - the add-on
 * reads the id first and can report the failure against it rather than dropping it silently.
 */
export function encodeRequest(request: BridgeRequest): string {
  if (!/^[a-z][a-z0-9_]*$/.test(request.action)) {
    throw new BridgeProtocolError(`action ${JSON.stringify(request.action)} is not a plain name`);
  }
  if (!ID_PATTERN.test(request.id)) {
    // Ids are echoed on every line of a reply, so a long one eats the line budget that
    // should be carrying blocks.
    throw new BridgeProtocolError(`id ${JSON.stringify(request.id)} must be 1-12 lowercase alphanumerics`);
  }

  const json = JSON.stringify(request.args ?? {});
  if (json.includes('\n')) {
    throw new BridgeProtocolError('arguments cannot contain a newline; the command is one line');
  }
  return `scriptevent mcp:${request.action} ${request.id} ${json}`;
}

/**
 * Reads one chat line, or returns null if it is not ours.
 *
 * A player typing something that happens to start with the tag would parse as a reply, which
 * is why ids are generated rather than sequential - a collision needs the player to guess a
 * live request id, not merely to be mischievous.
 */
export function parseLine(message: string): BridgeLine | null {
  // `[Kai_U] MCPB|a7|{...}` - the name is whoever the add-on used to speak.
  const withoutName = message.replace(/^\[[^\]]*\]\s*/, '');
  if (!withoutName.startsWith(`${BRIDGE_TAG}|`)) return null;

  const firstBar = withoutName.indexOf('|');
  const secondBar = withoutName.indexOf('|', firstBar + 1);
  if (secondBar < 0) return null;

  const rawId = withoutName.slice(firstBar + 1, secondBar);
  const body = withoutName.slice(secondBar + 1);

  const dot = rawId.indexOf('.');
  const id = dot < 0 ? rawId : rawId.slice(0, dot);
  const part = dot < 0 ? null : Number(rawId.slice(dot + 1));
  if (part !== null && !Number.isInteger(part)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    // A reply whose JSON is broken is still a reply, and saying so is better than pretending
    // the request went unanswered - the two call for different responses.
    throw new BridgeProtocolError(`reply for ${id} is not JSON: ${body.slice(0, 80)}`);
  }

  return { id, part, payload };
}

/** What a multi-part answer's header must carry for its completeness to be checkable. */
export interface PartHeader {
  readonly parts: number;
}

function isPartHeader(payload: unknown): payload is PartHeader {
  return typeof payload === 'object' && payload !== null && typeof (payload as PartHeader).parts === 'number';
}

export interface Assembled {
  readonly header: Record<string, unknown>;
  /** In part order, with no gaps - {@link assemble} refuses to return an incomplete set. */
  readonly parts: readonly unknown[];
}

/**
 * Puts a split answer back together, or says exactly what is missing.
 *
 * Refusing an incomplete set is the point. A dropped line is invisible at this level - the
 * remaining parts are all well formed - so without the header's count a short answer would
 * be handed to the model as a complete one, and it would reason about a region it had only
 * partly seen.
 */
export function assemble(lines: readonly BridgeLine[]): Assembled {
  const header = lines.find((line) => line.part === null);
  if (header === undefined) {
    throw new BridgeProtocolError('no header line; cannot tell how many parts to expect');
  }
  if (!isPartHeader(header.payload)) {
    // A single-line answer: no parts were promised, so there is nothing to assemble.
    return { header: header.payload as Record<string, unknown>, parts: [] };
  }

  const expected = header.payload.parts;
  const byPart = new Map<number, unknown>();
  for (const line of lines) {
    if (line.part === null) continue;
    byPart.set(line.part, line.payload);
  }

  const missing: number[] = [];
  for (let part = 0; part < expected; part++) {
    if (!byPart.has(part)) missing.push(part);
  }
  if (missing.length) {
    throw new BridgeProtocolError(
      `answer is incomplete: ${missing.length} of ${expected} parts missing (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''})`
    );
  }

  const parts: unknown[] = [];
  for (let part = 0; part < expected; part++) parts.push(byPart.get(part));
  return { header: header.payload as unknown as Record<string, unknown>, parts };
}

/**
 * How many items of a given kind fit in one line.
 *
 * Used to choose `perMessage` before a request goes out, since the add-on cannot know how
 * long the names it is about to find will be. Deliberately pessimistic: it costs an extra
 * line to be wrong low, and an entire lost answer to be wrong high.
 */
export function itemsPerLine(idLength: number, averageItemChars: number): number {
  // `[playername] MCPB|<id>.<part>|{"part":NNN,"blocks":[]}` plus a quote and comma per item.
  const overhead = 20 + idLength + 4 + 30;
  const usable = MAX_LINE - overhead;
  return Math.max(1, Math.floor(usable / (averageItemChars + 3)));
}
