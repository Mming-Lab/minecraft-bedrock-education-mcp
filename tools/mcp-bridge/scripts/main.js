// The bridge between the MCP server and the Script API.
//
// Requests arrive as `/scriptevent mcp:<action> <id> <json>`, sent over the WebSocket the MCP
// server already holds. Answers go back as chat, which arrives on that same socket as a
// PlayerMessage frame. No networking is needed from inside the game, which is the point: a
// client cannot open a socket, and @minecraft/server-net is documented as dedicated-server
// only.
//
// ## Two things that took three sessions to find
//
// `world.sendMessage` does not reach the socket. `player.runCommand('say ...')` does. The
// first bridge used only sendMessage and looked completely dead; measured side by side, the
// API path delivered nothing and the command path delivered everything.
//
// `dimension.runCommand` is not the way in. The command has to go through a player - which
// also means nothing can be said before one exists, so the boot notice waits rather than
// firing on the first tick.
//
// ## Why the module version is pinned to 2.1.0
//
// Fourteen versions from 1.7.0 up were installed side by side and only 2.1.0 answered.
// `min_engine_version` turned out not to matter: the same script worked at 1.18.30 and at
// 1.21.0.

import { world, system } from '@minecraft/server';

const TAG = 'MCPB';
const VERSION = '0.1.0';

/**
 * The output path.
 *
 * `tell @s` rather than `say`, because `say` broadcasts: a 4096-block read puts 172 lines in
 * front of everyone in the world, which in a classroom is the whole chat gone. A private
 * message is never sent to the rest of the class at all.
 *
 * Both were measured side by side. Both reach the socket; the ceilings are 481 characters for
 * `say` and 484 for `tell`, so nothing is given up by choosing the quiet one.
 *
 * Hiding the chat instead was the other candidate, and it is not available. `/hud` takes
 * hotbar, crosshair, paperdoll, armor, health, progress_bar, hunger, air_bubbles,
 * horse_health, status_effects, item_text and all - enumerated by asking the game rather than
 * by guessing - and `chat` is not among them. So the lines still land in the operator's own
 * chat, which is acceptable: they are the one driving this.
 *
 * `world.sendMessage` is not an option however tempting it looks. It prints in the game and
 * fires nothing, because PlayerMessage is a *player* event. That cost three sessions.
 */
const CHANNEL = 'tell';

function send(text) {
  const player = world.getPlayers()[0];
  if (!player) return false;
  try {
    player.runCommand(CHANNEL === 'tell' ? 'tell @s ' + text : 'say ' + text);
    return true;
  } catch {
    return false;
  }
}

function reply(id, payload) {
  return send(TAG + '|' + id + '|' + JSON.stringify(payload));
}

function fail(id, error) {
  reply(id, { ok: false, error: String((error && error.message) || error) });
}

const handlers = {
  /**
   * Which return channel to use, and whether the chat can be hidden while it is used.
   *
   * The bridge answers through chat because that is the only path that reaches the socket,
   * and that means a 4096-block read puts 172 lines in front of everyone in the world. In a
   * classroom that is the whole chat gone. Two things might fix it, and the add-on can do
   * both itself:
   *
   *   tell @s   should be visible only to the one player rather than broadcast
   *   hud       should hide the chat element entirely, leaving the transport alone
   *
   * Neither has been measured. `tell` might not fire PlayerMessage at all - `say` does and
   * `world.sendMessage` does not, so the difference is not obvious from the outside - and its
   * line limit might differ from say's 481. So this sends the same payload both ways, tagged,
   * and lets the far end report which arrived.
   */
  channel(id, args) {
    const player = world.getPlayers()[0];
    if (!player) {
      reply(id, { ok: false, error: 'no player' });
      return;
    }
    const chars = Math.min(args.chars || 200, 1200);
    const filler = 'y'.repeat(chars);
    const results = {};

    // Hiding first, so a channel that only works while the chat is visible shows up as such.
    if (args.hide) {
      try {
        player.runCommand('hud @s hide chat');
        results.hud_hide = 'accepted';
      } catch (error) {
        results.hud_hide = String((error && error.message) || error);
      }
    }

    for (const verb of ['say', 'tell']) {
      try {
        const text = TAG + '|' + id + '.' + verb + '|' + filler;
        player.runCommand(verb === 'tell' ? 'tell @s ' + text : 'say ' + text);
        results[verb] = 'sent';
      } catch (error) {
        results[verb] = String((error && error.message) || error);
      }
    }

    if (args.hide) {
      try {
        player.runCommand('hud @s reset');
        results.hud_reset = 'accepted';
      } catch (error) {
        results.hud_reset = String((error && error.message) || error);
      }
    }

    // Through `say`, which is known to arrive, so the summary itself is never the casualty.
    reply(id, { ok: true, chars, results });
  },

  /** Proves the pack is live and reports what the runtime will admit to. */
  ping(id) {
    reply(id, { ok: true, version: VERSION, tick: system.currentTick, players: world.getPlayers().length });
  },

  /**
   * One block, exactly - with its states, which no command can report.
   *
   * `getBlock` returns undefined for a chunk that is not loaded. That is reported as its own
   * answer rather than as air: "nothing there" and "not looked at" are different, and
   * flattening them would have the model believe it had seen an empty space.
   */
  getblock(id, args) {
    const dimension = world.getDimension(args.dimension || 'overworld');
    const block = dimension.getBlock({ x: args.x, y: args.y, z: args.z });
    if (!block) {
      reply(id, { ok: false, error: 'chunk not loaded', x: args.x, y: args.y, z: args.z });
      return;
    }
    let states = {};
    try {
      states = block.permutation.getAllStates();
    } catch {
      /* older runtimes name this differently; the id alone is still worth having */
    }
    reply(id, { ok: true, name: block.typeId, states, x: args.x, y: args.y, z: args.z });
  },

  /**
   * A box of blocks, split across as many chat lines as it takes.
   *
   * `perMessage` is deliberately a parameter: how much fits in one line is the number that
   * decides whether this channel is usable for bulk reads, and it has not been measured yet.
   */
  readregion(id, args) {
    const dimension = world.getDimension(args.dimension || 'overworld');
    const perMessage = args.perMessage || 30;
    const names = [];
    let missing = 0;

    for (let x = args.x1; x <= args.x2; x++) {
      for (let y = args.y1; y <= args.y2; y++) {
        for (let z = args.z1; z <= args.z2; z++) {
          const block = dimension.getBlock({ x, y, z });
          if (!block) {
            missing++;
            names.push(null);
          } else {
            names.push(block.typeId.replace('minecraft:', ''));
          }
        }
      }
    }

    const parts = Math.ceil(names.length / perMessage);
    reply(id, {
      ok: true,
      total: names.length,
      missing,
      parts,
      size: [args.x2 - args.x1 + 1, args.y2 - args.y1 + 1, args.z2 - args.z1 + 1],
      origin: [args.x1, args.y1, args.z1],
    });
    for (let part = 0; part < parts; part++) {
      reply(id + '.' + part, { part, blocks: names.slice(part * perMessage, (part + 1) * perMessage) });
    }
  },

  /**
   * Entities near a point - which the world file cannot give.
   *
   * This is what the add-on is actually for. Bulk block reading goes to the database: it has
   * the blocks with their states already, unlimited in area, and needs no add-on at all. What
   * the database does not have is anything live - where a mob is right now, what is in a
   * chest, who is standing where.
   */
  entities(id, args) {
    const dimension = world.getDimension(args.dimension || 'overworld');
    const found = dimension.getEntities({
      location: { x: args.x, y: args.y, z: args.z },
      maxDistance: args.radius || 16,
    });

    const entities = found.slice(0, args.limit || 20).map((entity) => {
      const at = entity.location;
      const record = {
        type: entity.typeId,
        x: Math.round(at.x * 10) / 10,
        y: Math.round(at.y * 10) / 10,
        z: Math.round(at.z * 10) / 10,
      };
      // Not every entity has every component, and asking for one it lacks throws rather than
      // returning nothing - so each is its own attempt.
      try {
        const health = entity.getComponent('health');
        if (health) record.health = Math.round(health.currentValue);
      } catch { /* no health component */ }
      try {
        if (entity.nameTag) record.name = entity.nameTag;
      } catch { /* no name */ }
      return record;
    });

    reply(id, { ok: true, total: found.length, returned: entities.length, entities });
  },

  /**
   * What is in a container - also absent from any command.
   *
   * The database does hold chest contents, but reading them means decoding a BlockEntity
   * record and waiting for a flush; this answers now.
   */
  container(id, args) {
    const dimension = world.getDimension(args.dimension || 'overworld');
    const block = dimension.getBlock({ x: args.x, y: args.y, z: args.z });
    if (!block) {
      reply(id, { ok: false, error: 'chunk not loaded' });
      return;
    }
    let inventory = null;
    try {
      inventory = block.getComponent('inventory');
    } catch { /* not a container */ }
    if (!inventory) {
      reply(id, { ok: false, error: 'not a container', name: block.typeId });
      return;
    }

    const container = inventory.container;
    const items = [];
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      if (item) items.push({ slot, type: item.typeId, amount: item.amount });
    }
    reply(id, { ok: true, name: block.typeId, size: container.size, items });
  },

  /**
   * How much gets through, and how fast.
   *
   * Chat lines have a length limit somewhere and possibly a rate limit; neither is documented
   * for this path. What arrives decides whether a region read is one round trip or a hundred.
   */
  bench(id, args) {
    const count = Math.min(args.count || 20, 400);
    const chars = Math.min(args.chars || 200, 2000);
    const filler = 'x'.repeat(chars);
    reply(id, { ok: true, sending: count, chars, tick: system.currentTick });
    for (let i = 0; i < count; i++) {
      send(TAG + '|' + id + '.' + i + '|' + system.currentTick + '|' + filler);
    }
  },
};

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (!event.id.startsWith('mcp:')) return;
  const action = event.id.slice(4);
  let id = '?';
  try {
    // `<requestId> <json>` - the id first, so a malformed body can still be answered.
    const space = event.message.indexOf(' ');
    id = space < 0 ? event.message : event.message.slice(0, space);
    const args = space < 0 ? {} : JSON.parse(event.message.slice(space + 1));

    const handler = handlers[action];
    if (!handler) {
      fail(id, 'no handler for ' + action);
      return;
    }
    handler(id, args);
  } catch (error) {
    fail(id, error);
  }
});

// A player has to exist before anything can be said, so this waits rather than firing on the
// first tick - the earlier version announced into a world with nobody in it.
system.runTimeout(() => {
  reply('boot', { ok: true, version: VERSION });
}, 60);
