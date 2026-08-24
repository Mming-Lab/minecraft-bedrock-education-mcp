/**
 * The socket the game connects to, and the one line of it that is easy to get wrong.
 *
 * {@link BridgeClient} needs two things of the world: a way to send a command, and a way to
 * hear what is said. Both exist already inside socket-be - `world.runCommand` and the
 * `PlayerMessage` event - so this file is mostly plumbing. The part that is not plumbing is
 * *when* the event handler is registered.
 *
 * ## Register before the game connects, not after
 *
 * A Bedrock WebSocket client sends nothing it was not asked for. The server subscribes by
 * name (`{"messagePurpose":"subscribe","body":{"eventName":"PlayerMessage"}}`), and socket-be
 * builds that list from the handlers registered on the `Server` at the moment a connection
 * arrives:
 *
 *     for (const registered of this.server.getRegisteredEvents()) { ... send subscribe ... }
 *
 * Registering afterwards adds a listener to an event nobody is publishing. Nothing throws and
 * nothing warns; chat simply never arrives, which reads exactly like an add-on that failed to
 * load. That mistake cost a session, and it is why the registration below happens in the
 * constructor with no `await` between it and `new Server(...)`, and why there is no public
 * method for adding socket-be listeners later.
 *
 * ## Encryption has to match the game, and the mismatch is silent
 *
 * socket-be negotiates encryption on connect unless told not to. Which side to match is not a
 * preference: a game set to refuse encryption completes `/connect` and then goes quiet, and a
 * game that requires it never becomes a command target. Neither says so. {@link
 * SocketBridgeTransport.whenConnected} therefore takes a timeout and names encryption in what
 * it throws, because "no world connected" on its own invites the same wrong conclusion that
 * has already been reached four times in this project.
 *
 * The one machine measured so far had encryption switched off in the game and ran with
 * `disableEncryption: true`. That is a setting an operator changed, not the stock behaviour,
 * so the default here follows socket-be's.
 */

import { Server, ServerEvent, type World } from 'socket-be';
import type { BridgeTransport, CommandOutcome, CommandRunner } from './client.js';

/** What `/connect localhost:19131` reaches. Bedrock has no default of its own. */
export const DEFAULT_PORT = 19131;

export interface SocketBridgeOptions {
  /** Defaults to {@link DEFAULT_PORT}. Pass 0 to have the OS pick one - useful in tests. */
  readonly port?: number;
  /**
   * Which interface to listen on. Left unset, `ws` binds all of them, which is what lets the
   * classroom arrangement work: other machines connect to the teacher's (D-12).
   */
  readonly host?: string;
  /** Must match the game's setting. See the note at the top of this file. */
  readonly disableEncryption?: boolean;
  /** How long a command may go unacknowledged. socket-be's own default is 10s. */
  readonly commandTimeoutMs?: number;
}

export class BridgeTransportError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BridgeTransportError';
  }
}

/**
 * A {@link BridgeTransport} backed by a real WebSocket the game dials into.
 *
 * One world is served at a time. The first to connect is the one commands go to, and it is
 * replaced only when it goes away - not when a newer one arrives. A classroom can have
 * several machines pointed at this port, and picking the latest would mean a student joining
 * mid-read silently taking the channel away from a request already in flight.
 */
export class SocketBridgeTransport implements BridgeTransport, CommandRunner {
  private readonly server: Server;
  private readonly listeners = new Set<(message: string) => void>();
  private readonly waiting = new Set<() => void>();
  private readonly commandTimeoutMs: number;
  private readonly requestedPort: number;
  private readonly encrypted: boolean;
  private world: World | null = null;
  private listenError: Error | null = null;

  /** Resolves once the port is bound, so a caller can print it - or read it back from port 0. */
  readonly listening: Promise<void>;

  constructor(options: SocketBridgeOptions = {}) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
    this.requestedPort = options.port ?? DEFAULT_PORT;
    this.encrypted = !(options.disableEncryption ?? false);

    this.server = new Server({
      port: this.requestedPort,
      disableEncryption: !this.encrypted,
      ...(options.host === undefined ? {} : { webSocketOptions: { host: options.host } }),
    });

    // Nothing may be awaited between the line above and these handlers: the subscription list
    // a connecting game is sent is whatever is registered at that moment. `new
    // WebSocketServer` binds asynchronously, so registering here - synchronously, in the same
    // turn - is in time for the first connection, and only just.
    // Resolves when the attempt is settled, either way - not only when it succeeds. socket-be
    // registers no `error` handler on its WebSocketServer, and an EventEmitter with no
    // listener for `error` throws: a port already in use would take the whole MCP server down,
    // and with it the building tools, which need no port at all. Failing to listen should cost
    // the reading tools and nothing else.
    this.listening = new Promise<void>((resolve) => {
      this.server.on(ServerEvent.Open, () => resolve());
      this.server.network.wss.on('error', (error: unknown) => {
        this.listenError = error instanceof Error ? error : new Error(String(error));
        resolve();
      });
    });

    // Same reason, one level down: socket-be attaches `message` and `close` to each socket but
    // not `error`, so a game that dies mid-session - or any reset connection - would throw out
    // of the emitter. `close` still follows, so there is nothing to do here but absorb it.
    this.server.network.wss.on('connection', (socket: { on(event: string, listener: () => void): void }) => {
      socket.on('error', () => {});
    });

    this.server.on(ServerEvent.PlayerMessage, (signal) => {
      // Only the world this transport is bound to. Ids are random rather than sequential, so
      // a stray match is unlikely, but another world's chat is noise at best and someone
      // else's answer at worst.
      if (signal.world !== this.world) return;
      // Over a copy, because a listener may remove itself - BridgeClient's does, on the line
      // that completes a request.
      for (const listener of [...this.listeners]) listener(signal.message);
    });

    this.server.on(ServerEvent.WorldAdd, ({ world }) => {
      if (this.world !== null) return;
      this.world = world;
      for (const wake of [...this.waiting]) wake();
    });

    this.server.on(ServerEvent.WorldRemove, ({ world }) => {
      if (this.world !== world) return;
      this.world = this.server.getWorlds().find((other) => other !== world && other.isValid) ?? null;
    });
  }

  /** The port actually bound, which differs from the one asked for only when that was 0. */
  get port(): number {
    const address = this.server.network.wss.address();
    return typeof address === 'object' && address !== null ? address.port : this.requestedPort;
  }

  /** Whether a world is currently on the other end. */
  get connected(): boolean {
    return this.world !== null;
  }

  /** Why the port could not be opened, if it could not. Null while the socket is healthy. */
  get listenFailure(): Error | null {
    return this.listenError;
  }

  /**
   * What to tell someone who asked the world a question and there is no world.
   *
   * "Not connected" is true in both cases and useless in one of them: if the port never
   * opened, no amount of typing `/connect` will help, and the thing to say is which port to
   * try instead.
   */
  private noWorldMessage(): string {
    if (this.listenError !== null) {
      return (
        `the bridge could not listen on port ${this.requestedPort}: ${this.listenError.message}. ` +
        `Another program is probably using it. Start the server again with a different --port, ` +
        `and use that port in /connect. Building tools are unaffected.`
      );
    }
    return `Minecraft is not connected. In the game, open the chat and run /connect localhost:${this.port}.`;
  }

  /**
   * Waits for a game to connect.
   *
   * The timeout is not impatience. A `/connect` that reaches the wrong side of the encryption
   * setting looks identical to one that was never typed, which looks identical to an add-on
   * that failed to load - so the failure has to name the possibilities rather than leave the
   * caller to settle on whichever comes to mind first.
   */
  whenConnected(timeoutMs?: number): Promise<void> {
    if (this.world !== null) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const wake = () => {
        if (timer !== null) clearTimeout(timer);
        this.waiting.delete(wake);
        resolve();
      };
      this.waiting.add(wake);

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.waiting.delete(wake);
          reject(
            new BridgeTransportError(
              this.listenError !== null
                ? `no world connected within ${timeoutMs}ms: ${this.noWorldMessage()}`
                : `no world connected within ${timeoutMs}ms. In the game, run /connect localhost:${this.port}. ` +
                  `If that was already done and nothing happened, check the encryption setting: this server ` +
                  `${this.encrypted ? 'negotiates encryption' : 'refuses encryption'}, and a game set the ` +
                  `other way accepts the /connect and then stays silent.`
            )
          );
        }, timeoutMs);
      }
    });
  }

  /**
   * Sends one command line to the connected world.
   *
   * The reply is awaited but not judged. A negative `statusCode` from Bedrock does not mean
   * the command was refused - "0 blocks filled" and "that block cannot be placed" are both
   * negative and both describe something that worked - and what `scriptevent` returns when
   * the add-on is absent has not been measured. Treating the code as a verdict would turn a
   * delivered request into a reported failure, so the only failures raised here are the ones
   * socket-be itself reports: a closed connection, or no acknowledgement at all.
   */
  async send(commandLine: string): Promise<void> {
    await this.run(commandLine);
  }

  /**
   * Sends a command and returns what the game said about it.
   *
   * Same trip as {@link send}, with the answer kept. Placing blocks wants it; the bridge
   * does not, because a `scriptevent`'s real answer arrives later over chat.
   */
  async run(commandLine: string): Promise<CommandOutcome> {
    const world = this.world;
    if (world === null) throw new BridgeTransportError(this.noWorldMessage());

    try {
      const result = await world.runCommand(commandLine, { timeout: this.commandTimeoutMs });
      return {
        commandLine,
        statusCode: typeof result.statusCode === 'number' ? result.statusCode : 0,
        statusMessage: typeof result.statusMessage === 'string' ? result.statusMessage : '',
      };
    } catch (error) {
      throw new BridgeTransportError(
        `the game did not acknowledge ${JSON.stringify(commandLine.slice(0, 60))}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error
      );
    }
  }

  /** Registers a chat listener. The returned function removes it. */
  onChat(listener: (message: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops listening and drops every connected world. */
  async close(): Promise<void> {
    this.world = null;
    this.listeners.clear();
    this.waiting.clear();
    await this.server.stop();
  }
}
