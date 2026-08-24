// A WebSocket client that answers the way Bedrock does.
//
// Shared by the transport tests, which point it at a transport built in-process, and by the
// end-to-end test, which points it at the real server running as a child process. Same fake
// either way, so a behaviour that only holds in one of them shows up as a disagreement rather
// than as two subtly different stand-ins.
//
// The frame shapes come from a recorded session (tools/live-probe/dump), including the detail
// that a `tell` arrives bare while a `say` arrives as `[Name] message`.

import { WebSocket } from 'ws';

export const PLAYER = 'Kai_U';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class FakeGame {
  constructor(ws) {
    this.ws = ws;
    /** Every `subscribe` frame the server sent on connect - which events it is listening for. */
    this.subscribed = [];
    /** Every command line the server ran, in order. */
    this.commands = [];
    /**
     * Stands in for the add-on: given a command line, the chat lines the pack would say.
     *
     * Returning fewer lines than the header promises is how a dropped chat line is simulated,
     * and that is the failure that has to stay visible.
     */
    this.addon = () => [];
  }

  static async connect(port) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const game = new FakeGame(ws);
    // Before the open handshake resolves, not after. The server subscribes the moment the
    // connection lands, and `ws` drops a message that arrives with no listener attached - so
    // waiting for `open` first loses exactly the frames the transport test exists to check.
    // The same ordering mistake as the one being tested for, one layer down.
    ws.on('message', (data) => game.receive(data));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return game;
  }

  receive(data) {
    const frame = JSON.parse(data.toString());
    const { messagePurpose, requestId } = frame.header;

    if (messagePurpose === 'subscribe') {
      this.subscribed.push(frame.body.eventName);
      return;
    }
    if (messagePurpose !== 'commandRequest') return;

    const commandLine = frame.body.commandLine;
    this.commands.push(commandLine);

    // The two socket-be asks for on its own, before anything of ours is sent. Left unanswered
    // they only log, but answering keeps the noise out of a failing test's output.
    if (commandLine === 'getlocalplayername') {
      this.respond(requestId, { statusCode: 0, localplayername: PLAYER });
      return;
    }
    if (commandLine === 'list') {
      this.respond(requestId, { statusCode: 0, players: PLAYER, current: 1, max: 8 });
      return;
    }

    this.respond(requestId, { statusCode: 0, statusMessage: '' });
    for (const line of this.addon(commandLine)) {
      // On a later turn, as chat is: no reply arrives inside the command's own response.
      setTimeout(() => this.say(line), 5);
    }
  }

  respond(requestId, body) {
    this.send({ header: { version: 1, requestId, messagePurpose: 'commandResponse' }, body });
  }

  /** A `tell` - which arrives bare, unlike `say`, which arrives as `[Name] message`. */
  say(message, { type = 'tell', sender = PLAYER } = {}) {
    this.send({
      header: {
        version: 1,
        requestId: '00000000-0000-0000-0000-000000000000',
        messagePurpose: 'event',
        eventName: 'PlayerMessage',
      },
      body: { type, message, sender, receiver: type === 'tell' ? PLAYER : '' },
    });
  }

  send(frame) {
    this.ws.send(JSON.stringify(frame));
  }

  close() {
    return new Promise((resolve) => {
      this.ws.once('close', resolve);
      this.ws.close();
    });
  }
}
