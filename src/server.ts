import { Server as SocketBE, ServerEvent, World, Agent } from "socket-be";
import { v4 as uuidv4 } from "uuid";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ConnectedPlayer,
  ToolCallResult,
} from "./types";

// Advanced Building ツール
import { BuildCubeTool } from "./tools/advanced/building/build-cube";
import { BuildLineTool } from "./tools/advanced/building/build-line";
import { BuildSphereTool } from "./tools/advanced/building/build-sphere";
import { BuildParaboloidTool } from "./tools/advanced/building/build-paraboloid";
import { BuildHyperboloidTool } from "./tools/advanced/building/build-hyperboloid";
import { BuildCylinderTool } from "./tools/advanced/building/build-cylinder";
import { BuildTorusTool } from "./tools/advanced/building/build-torus";
import { BuildHelixTool } from "./tools/advanced/building/build-helix";
import { BuildEllipsoidTool } from "./tools/advanced/building/build-ellipsoid";
import { BuildRotateTool } from "./tools/advanced/building/build-rotate";
import { BuildTransformTool } from "./tools/advanced/building/build-transform";
import { BuildBezierTool } from "./tools/advanced/building/build-bezier";

// Socket-BE Core API ツール（推奨）
import { AgentTool } from "./tools/core/agent";
import { WorldTool } from "./tools/core/world";
import { PlayerTool } from "./tools/core/player";
import { BlocksTool } from "./tools/core/blocks";
import { SystemTool } from "./tools/core/system";
import { CameraTool } from "./tools/core/camera";
import { SequenceTool } from "./tools/core/sequence";
import { MinecraftWikiTool } from "./tools/core/minecraft-wiki";

import { BaseTool } from "./tools/base/tool";
import { initializeLocale, SupportedLocale } from "./utils/i18n/locale-manager";
import {
  optimizeBuildResult,
  optimizeCommandResult,
  checkResponseSize,
} from "./utils/token-optimizer";
import { SchemaToZodConverter } from "./utils/schema-converter";
import { enrichErrorWithHints } from "./utils/error-hints";

/**
 * Minecraft Bedrock Edition用MCPサーバー
 *
 * WebSocket接続を通じてMinecraft Bedrock Editionを制御し、
 * MCP（Model Context Protocol）プロトコルを実装して
 * AIクライアント（Claude Desktopなど）との統合を提供します。
 *
 * @description
 * このサーバーは以下の機能を提供します：
 * - WebSocket経由でのMinecraft Bedrock Edition接続
 * - MCP 2.0プロトコル準拠のAIクライアント統合
 * - 15種類の階層化ツール（基本操作・複合操作）
 * - プレイヤー、エージェント、ワールド、建築制御
 *
 * @example
 * ```typescript
 * // サーバーの起動
 * const server = new MinecraftMCPServer();
 * server.start(8001);
 *
 * // Minecraftから接続: /connect localhost:8001/ws
 * ```
 *
 * @since 1.0.0
 * @author mcbk-mcp contributors
 * @see {@link https://github.com/Mming-Lab/minecraft-bedrock-mcp-server}
 * @see {@link https://modelcontextprotocol.io/} MCP Protocol
 */
export class MinecraftMCPServer {
  private connectedPlayer: ConnectedPlayer | null = null;
  private socketBE: SocketBE | null = null;
  private tools: BaseTool[] = [];
  private currentWorld: World | null = null;
  private currentAgent: Agent | null = null;
  private mcpServer: McpServer;

  constructor() {
    // MCP公式SDKのサーバーを初期化
    this.mcpServer = new McpServer(
      {
        name: "minecraft-bedrock-education-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  /**
   * MCPサーバーを起動します
   *
   * WebSocketサーバーとMCPインターフェースを初期化し、
   * Minecraftクライアントとの接続を待機します。
   *
   * @param port - WebSocketサーバーのポート番号（デフォルト: 8001）
   * @throws WebSocketサーバーの起動に失敗した場合
   *
   * @example
   * ```typescript
   * const server = new MinecraftMCPServer();
   * server.start(8001); // ポート8001で起動
   *
   * // Minecraftから接続:
   * // /connect localhost:8001/ws
   * ```
   */
  public async start(port: number = 8001, locale?: SupportedLocale): Promise<void> {
    // 言語設定を初期化
    initializeLocale(locale);

    // MCP及びツールの初期化
    await this.setupMCPServer();

    // Socket-BEサーバーの起動
    this.setupSocketBEServer(port);

    // イベントハンドラーの登録
    this.setupEventHandlers();
  }

  /**
   * MCPサーバーとツールを初期化
   * @private
   */
  private async setupMCPServer(): Promise<void> {
    // ツールの初期化
    this.initializeTools();

    // 基本ツールの登録
    this.registerBasicTools();

    // モジュラーツールの登録
    this.registerModularTools();

    // MCP Stdio Transportに接続
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }

  /**
   * Socket-BEサーバーを起動
   * @private
   */
  private setupSocketBEServer(port: number): void {
    // Socket-BE Minecraftサーバーを起動
    this.socketBE = new SocketBE({ port });

    // MCPモードでない場合のみstderrにログ出力
    if (process.stdin.isTTY !== false) {
      console.error(
        `SocketBE Minecraft WebSocketサーバーを起動中 ポート:${port}`
      );
      console.error(`Minecraftから接続: /connect localhost:${port}/ws`);
    }
  }

  /**
   * Socket-BEイベントハンドラーを登録
   * @private
   */
  private setupEventHandlers(): void {
    if (!this.socketBE) return;

    this.socketBE.on(ServerEvent.Open, () => {
      this.handleServerOpen();
    });

    this.socketBE.on(ServerEvent.PlayerJoin, async (ev: any) => {
      await this.handlePlayerJoin(ev);
    });

    this.socketBE.on(ServerEvent.PlayerLeave, (ev: any) => {
      this.handlePlayerLeave(ev);
    });
  }

  /**
   * サーバーOpen時の処理
   * @private
   */
  private handleServerOpen(): void {
    if (process.stdin.isTTY !== false) {
      console.error("SocketBEサーバーが開始されました");
    }

    // 10秒後に強制的にワールドとエージェントを設定
    this.scheduleWorldInitialization(10000);

    // 定期的なワールドチェック（30秒ごと）
    this.startPeriodicWorldCheck(30000);
  }

  /**
   * ワールド初期化をスケジュール
   * @private
   */
  private scheduleWorldInitialization(delayMs: number): void {
    setTimeout(async () => {
      try {
        const worlds = this.socketBE?.worlds;
        if (worlds && worlds instanceof Map && worlds.size > 0) {
          await this.initializeWorld(Array.from(worlds.values())[0]);
          await this.sendWorldMessage("§a[MCP Server] 接続完了！AIツールが利用可能になりました。");
        }
      } catch (error) {
        // 強制設定失敗は無視してサーバー継続
      }
    }, delayMs);
  }

  /**
   * 定期的なワールドチェックを開始
   * @private
   */
  private startPeriodicWorldCheck(intervalMs: number): void {
    setInterval(async () => {
      if (!this.currentWorld && this.socketBE) {
        const worlds = this.socketBE.worlds;
        if (worlds instanceof Map && worlds.size > 0) {
          await this.initializeWorld(Array.from(worlds.values())[0]);
          await this.sendWorldMessage("§a[MCP Server] 遅延接続完了！AIツールが利用可能になりました。");
        }
      }
    }, intervalMs);
  }

  /**
   * ワールドとエージェントを初期化し、ツールに設定
   * @private
   */
  private async initializeWorld(world: World): Promise<void> {
    this.currentWorld = world;

    // エージェントを取得
    try {
      this.currentAgent = await this.currentWorld.getOrCreateAgent();
    } catch (agentError) {
      // エージェント取得に失敗してもサーバーは継続
      this.currentAgent = null;
    }

    // 仮のプレイヤー情報を設定
    if (!this.connectedPlayer) {
      this.connectedPlayer = {
        ws: null,
        name: "MinecraftPlayer",
        id: uuidv4(),
      };
    }

    // 全ツールにSocket-BEインスタンスを設定
    this.updateToolsWithWorldInstances();
  }

  /**
   * 全ツールにワールドとエージェントを設定
   * @private
   */
  private updateToolsWithWorldInstances(): void {
    this.tools.forEach((tool) => {
      tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
    });
  }

  /**
   * ワールドにメッセージを送信（エラー無視）
   * @private
   */
  private async sendWorldMessage(message: string): Promise<void> {
    try {
      await this.currentWorld?.sendMessage(message);
    } catch (messageError) {
      // メッセージ送信失敗は無視
    }
  }

  /**
   * プレイヤー参加時の処理
   * @private
   */
  private async handlePlayerJoin(ev: any): Promise<void> {
    if (process.stdin.isTTY !== false) {
      console.error("新しいプレイヤーが参加しました:", ev.player.name);
    }

    // Minecraft側に参加確認メッセージを送信
    await this.sendWorldMessage(
      `§b[MCP Server] §f${ev.player.name}さん、ようこそ！AIアシスタントが利用可能です。`
    );

    this.connectedPlayer = {
      ws: null, // SocketBEではws直接アクセス不要
      name: ev.player.name || "unknown",
      id: uuidv4(),
    };

    this.currentWorld = ev.world;

    // エージェントを取得
    try {
      if (this.currentWorld) {
        this.currentAgent = await this.currentWorld.getOrCreateAgent();
      }
    } catch (error) {
      console.error("Failed to get or create agent:", error);
      this.currentAgent = null;
    }

    // 全ツールのSocket-BEインスタンスを更新
    this.updateToolsWithWorldInstances();
  }

  /**
   * プレイヤー退出時の処理
   * @private
   */
  private handlePlayerLeave(ev: any): void {
    if (process.stdin.isTTY !== false) {
      console.error(`プレイヤーが切断されました: ${ev.player.name}`);
    }

    this.connectedPlayer = null;
    this.currentWorld = null;
    this.currentAgent = null;

    // 全ツールのSocket-BEインスタンスをクリア
    this.tools.forEach((tool) => {
      tool.setSocketBEInstances(null, null);
    });
  }

  /**
   * 利用可能なツールを初期化します
   *
   * Level 1（基本操作）とLevel 2（複合操作）のツールを登録し、
   * 各ツールにコマンド実行関数を注入します。
   *
   * @internal
   */
  private initializeTools(): void {
    this.tools = [
      // Socket-BE Core API ツール（推奨 - シンプルでAI使いやすい）
      new AgentTool(),
      new WorldTool(),
      new PlayerTool(),
      new BlocksTool(),
      new SystemTool(),
      new CameraTool(),
      new SequenceTool(),
      new MinecraftWikiTool(),

      // Advanced Building ツール（高レベル建築機能）
      new BuildCubeTool(), // ✅ 完全動作
      new BuildLineTool(), // ✅ 完全動作
      new BuildSphereTool(), // ✅ 完全動作
      new BuildCylinderTool(), // ✅ 修正済み
      new BuildParaboloidTool(), // ✅ 基本動作
      new BuildHyperboloidTool(), // ✅ 基本動作
      new BuildRotateTool(), // ✅ 基本動作
      new BuildTransformTool(), // ✅ 基本動作
      new BuildTorusTool(), // ✅ 修正完了
      new BuildHelixTool(), // ✅ 修正完了
      new BuildEllipsoidTool(), // ✅ 修正完了
      new BuildBezierTool(), // ✅ 新規追加（可変制御点ベジェ曲線）
    ];

    // 全ツールにコマンド実行関数とSocket-BEインスタンスを設定
    const commandExecutor = async (
      command: string
    ): Promise<ToolCallResult> => {
      return this.executeCommand(command);
    };

    this.tools.forEach((tool) => {
      tool.setCommandExecutor(commandExecutor);
      tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
    });

    // SequenceToolにツールレジストリを設定
    const sequenceTool = this.tools.find(
      (tool) => tool.name === "sequence"
    ) as SequenceTool;
    if (sequenceTool) {
      const toolRegistry = new Map<string, BaseTool>();
      this.tools.forEach((tool) => {
        toolRegistry.set(tool.name, tool);
      });
      sequenceTool.setToolRegistry(toolRegistry);
    }
  }

  /**
   * MCP SDKに基本ツールを登録
   */
  private registerBasicTools(): void {
    // send_message ツール
    this.mcpServer.registerTool(
      "send_message",
      {
        title: "Send Message",
        description:
          "Send a chat message to the connected Minecraft player. ALWAYS provide a message parameter. Use this to communicate with the player about build progress or instructions.",
        inputSchema: {
          message: z
            .string()
            .describe(
              "The text message to send to the player (REQUIRED - never call this without a message)"
            ),
        },
      },
      async ({ message }: { message: string }) => {
        const result = await this.sendMessage(message || "Hello from MCP server!");

        let responseText: string;
        if (result.success) {
          responseText = result.message || "Message sent successfully";
        } else {
          // エラーメッセージにヒントを追加
          const errorMsg = result.message || "Failed to send message";
          responseText = `❌ ${enrichErrorWithHints(errorMsg)}`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      }
    );

    // execute_command ツール
    this.mcpServer.registerTool(
      "execute_command",
      {
        title: "Execute Command",
        description: "Execute a Minecraft command",
        inputSchema: {
          command: z.string().describe("The Minecraft command to execute"),
        },
      },
      async ({ command }: { command: string }) => {
        const result = await this.executeCommand(command);

        // トークン最適化: コマンド結果を要約
        const optimized = optimizeCommandResult(result.data);

        let responseText: string;
        if (result.success) {
          responseText = `✅ ${optimized.summary}`;
          if (optimized.details) {
            responseText += `\n\n${JSON.stringify(optimized.details, null, 2)}`;
          }
        } else {
          // エラーメッセージにヒントを追加
          const errorMsg = result.message || "Command execution failed";
          const enrichedError = enrichErrorWithHints(errorMsg);
          responseText = `❌ ${enrichedError}`;
        }

        // レスポンスサイズチェック
        const sizeWarning = checkResponseSize(responseText);
        if (sizeWarning) {
          responseText += `\n\n${sizeWarning}`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      }
    );
  }

  /**
   * MCP SDKにモジュラーツールを登録
   */
  private registerModularTools(): void {
    const schemaConverter = new SchemaToZodConverter();

    this.tools.forEach((tool) => {
      // inputSchemaをZod形式に変換（SchemaToZodConverterを使用）
      const zodSchema = schemaConverter.convert(tool.inputSchema);

      // ツールを登録
      this.mcpServer.registerTool(
        tool.name,
        {
          title: tool.name,
          description: tool.description,
          inputSchema: zodSchema,
        },
        async (args: any) => {
          try {
            const result = await tool.execute(args);

            let responseText: string;

            if (result.success) {
              // 建築ツールの場合は最適化
              if (tool.name.startsWith('build_')) {
                const optimized = optimizeBuildResult(result);
                responseText = `✅ ${optimized.message}`;
                if (optimized.summary) {
                  responseText += `\n\n📊 Summary:\n${JSON.stringify(optimized.summary, null, 2)}`;
                }
              } else {
                // 通常ツールの場合
                responseText = result.message || `Tool ${tool.name} executed successfully`;
                if (result.data) {
                  // データサイズチェック
                  const dataStr = JSON.stringify(result.data, null, 2);
                  const sizeWarning = checkResponseSize(dataStr);

                  if (sizeWarning) {
                    // 大きすぎる場合はデータタイプのみ表示
                    responseText += `\n\n${sizeWarning}`;
                    responseText += `\nData type: ${Array.isArray(result.data) ? `Array[${result.data.length}]` : typeof result.data}`;
                  } else {
                    responseText += `\n\nData: ${dataStr}`;
                  }
                }
              }
            } else {
              // エラーメッセージにヒントを追加
              const errorMsg = result.message || "Tool execution failed";
              const enrichedError = enrichErrorWithHints(errorMsg);
              responseText = `❌ ${enrichedError}`;
              if (result.data) {
                responseText += `\n\nDetails:\n${JSON.stringify(result.data, null, 2)}`;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: responseText,
                },
              ],
            };
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;

            const exceptionMessage = `Tool execution failed with exception: ${errorMsg}${errorStack ? `\n\nStack trace:\n${errorStack}` : ""}`;

            return {
              content: [
                {
                  type: "text",
                  text: `❌ ${exceptionMessage}`,
                },
              ],
            };
          }
        }
      );
    });
  }

  private lastCommandResponse: any = null;

  /**
   * 接続中のMinecraftプレイヤーにメッセージを送信します
   *
   * @param text - 送信するメッセージテキスト
   * @returns 送信結果
   *
   * @example
   * ```typescript
   * const result = server.sendMessage("Hello, Minecraft!");
   * if (result.success) {
   *   console.log("メッセージ送信成功");
   * }
   * ```
   */
  public async sendMessage(text: string): Promise<ToolCallResult> {
    if (!this.currentWorld) {
      if (process.stdin.isTTY !== false) {
        console.error("エラー: プレイヤーが接続されていません");
      }
      return { success: false, message: "No player connected" };
    }

    try {
      if (process.stdin.isTTY !== false) {
        console.error(`メッセージ送信: ${text}`);
      }

      await this.currentWorld.sendMessage(text);
      return { success: true, message: "Message sent successfully" };
    } catch (error) {
      if (process.stdin.isTTY !== false) {
        console.error("メッセージ送信エラー:", error);
      }
      return { success: false, message: `Failed to send message: ${error}` };
    }
  }

  /**
   * Minecraftコマンドを実行します
   *
   * @param command - 実行するMinecraftコマンド（"/"プレフィックスなし）
   * @returns コマンド実行結果
   *
   * @example
   * ```typescript
   * // プレイヤーをテレポート
   * server.executeCommand("tp @p 100 64 200");
   *
   * // ブロックを設置
   * server.executeCommand("setblock 0 64 0 minecraft:stone");
   * ```
   */
  public async executeCommand(command: string): Promise<ToolCallResult> {
    if (!this.currentWorld) {
      return { success: false, message: "No player connected" };
    }

    try {
      const result = await this.currentWorld.runCommand(command);

      // レスポンスをlastCommandResponseに保存（位置情報取得などで使用）
      this.lastCommandResponse = result;

      return {
        success: true,
        message: "Command executed successfully",
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: `Command execution failed: ${error}`,
      };
    }
  }

  /**
   * 最新のコマンドレスポンスを取得します（位置情報など）
   */
  public getLastCommandResponse(): any {
    return this.lastCommandResponse;
  }
}

// サーバーを開始
const server = new MinecraftMCPServer();

// ポート番号をコマンドライン引数から取得
const getPort = (): number => {
  // コマンドライン引数から取得 (--port=8002)
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  if (portArg) {
    const port = parseInt(portArg.split("=")[1]);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return port;
    }
  }

  // デフォルト値
  return 8001;
};

// 言語設定をコマンドライン引数から取得
const getLocale = (): SupportedLocale | undefined => {
  // コマンドライン引数から取得 (--lang=ja または --lang=en)
  const langArg = process.argv.find((arg) => arg.startsWith("--lang="));
  if (langArg) {
    const lang = langArg.split("=")[1];
    if (lang === "ja" || lang === "en") {
      return lang;
    }
  }

  // デフォルトは自動検出（undefined）
  return undefined;
};

const port = getPort();
const locale = getLocale();
server.start(port, locale);

process.on("SIGINT", () => {
  process.exit(0);
});
