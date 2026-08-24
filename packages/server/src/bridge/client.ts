/**
 * Matching replies to requests, over a channel that has neither.
 *
 * Chat is a broadcast: every line the add-on says arrives the same way, mixed in with
 * whatever the players are typing, in whatever order the game gets round to. There is no
 * request id in the transport and no framing - the correlation is entirely in the payload,
 * which is why every line carries the id it belongs to.
 *
 * The transport is injected rather than built here. The socket is socket-be's job, and
 * keeping it out means this - the part with the timeouts and the partial answers, where the
 * interesting mistakes live - can be tested without a game, a socket, or a machine that has
 * ever had Minecraft installed.
 */

import {
  assemble,
  BridgeProtocolError,
  encodeRequest,
  parseLine,
  type Assembled,
  type BridgeLine,
} from './protocol.js';

/** What the client needs of the world: send a command, and hear what is said. */
export interface BridgeTransport {
  /** Sends a command line. Resolving means it left, not that it was answered. */
  send(commandLine: string): Promise<void>;
  /** Registers a listener for chat. Returns a function that removes it. */
  onChat(listener: (message: string) => void): () => void;
}

export interface BridgeOptions {
  /**
   * How long to wait for the first line of an answer.
   *
   * A single block measured 171ms at the median and 235 at the slowest over ten samples, so
   * two seconds is generous for a point query. It is the *first* line that this bounds -
   * a long answer gets {@link quietMs} after each line instead.
   */
  readonly firstLineMs?: number;
  /**
   * How long to wait after the last line before deciding an answer is finished.
   *
   * A 4096-block read arrived as 172 lines in 3.7 seconds, so lines come far faster than
   * this; the gap only has to outlast a stall, not the whole answer.
   */
  readonly quietMs?: number;
  /** Supplied by the caller in tests so that timing is not real. */
  readonly now?: () => number;
}

export class BridgeTimeoutError extends Error {
  constructor(
    public readonly id: string,
    public readonly action: string,
    public readonly linesSoFar: number,
    message: string
  ) {
    super(message);
    this.name = 'BridgeTimeoutError';
  }
}

let counter = 0;

/**
 * A short, unique-enough id.
 *
 * Every line of a reply repeats it, so a long id costs blocks. Randomness matters less than
 * uniqueness within the handful of requests in flight, but it is not sequential either: a
 * player can type anything into chat, and guessing a live id should take more than counting.
 */
function nextId(): string {
  counter = (counter + 1) % 1296;
  const seq = counter.toString(36).padStart(2, '0');
  const salt = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
  return `${salt}${seq}`;
}

export class BridgeClient {
  private readonly firstLineMs: number;
  private readonly quietMs: number;

  constructor(
    private readonly transport: BridgeTransport,
    options: BridgeOptions = {}
  ) {
    this.firstLineMs = options.firstLineMs ?? 4000;
    this.quietMs = options.quietMs ?? 1500;
  }

  /**
   * Sends a request and collects every line of its answer.
   *
   * Resolves with the assembled answer, or rejects - a timeout and a partial answer are
   * different failures and the caller may want to retry one and not the other, so they are
   * distinct error types rather than one `null`.
   */
  async request(action: string, args: Record<string, unknown> = {}): Promise<Assembled> {
    const id = nextId();
    const lines: BridgeLine[] = [];

    let settle: (() => void) | null = null;
    let failure: Error | null = null;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });

    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    const stopWaiting = () => {
      if (quietTimer !== null) clearTimeout(quietTimer);
      settle?.();
    };

    const unlisten = this.transport.onChat((message) => {
      let line: BridgeLine | null;
      try {
        line = parseLine(message);
      } catch (error) {
        // Malformed JSON for *our* id is a real failure; for anyone else's it is noise.
        if (message.includes(`|${id}`)) {
          failure = error as Error;
          stopWaiting();
        }
        return;
      }
      if (line === null || line.id !== id) return;

      lines.push(line);

      // Each line resets the clock. An answer arrives as a burst, so the gap between lines is
      // a far better end-of-message signal than any fixed total.
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(stopWaiting, this.quietMs);
    });

    const firstLineTimer = setTimeout(() => {
      if (lines.length === 0) {
        failure = new BridgeTimeoutError(
          id,
          action,
          0,
          `no reply to ${action} within ${this.firstLineMs}ms. The add-on may not be loaded, or the world may need reloading after the pack changed.`
        );
        stopWaiting();
      }
    }, this.firstLineMs);

    try {
      await this.transport.send(encodeRequest({ action, id, args }));
      await done;
    } finally {
      clearTimeout(firstLineTimer);
      if (quietTimer !== null) clearTimeout(quietTimer);
      unlisten();
    }

    if (failure !== null) throw failure;

    try {
      return assemble(lines);
    } catch (error) {
      if (error instanceof BridgeProtocolError) {
        // Say how much did arrive. "Incomplete" with no number leaves the caller unable to
        // tell a near miss from a total loss, and those want different responses.
        throw new BridgeProtocolError(`${action} (${id}): ${error.message}; ${lines.length} lines arrived`);
      }
      throw error;
    }
  }
}
