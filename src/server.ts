import { Server as SocketBE, ServerEvent, World, Agent } from 'socket-be';
import { v4 as uuidv4 } from 'uuid';
import {
    MCPRequest,
    MCPResponse,
    Tool,
    ConnectedPlayer,
    ToolCallResult
} from './types';
// レベル1: 基本操作ツール（Socket-BE移行済み）

// Advanced Building ツール
import { BuildCubeTool } from './tools/advanced/building/build-cube';
import { BuildLineTool } from './tools/advanced/building/build-line';
import { BuildSphereTool } from './tools/advanced/building/build-sphere';
import { BuildParaboloidTool } from './tools/advanced/building/build-paraboloid';
import { BuildHyperboloidTool } from './tools/advanced/building/build-hyperboloid';
import { BuildCylinderTool } from './tools/advanced/building/build-cylinder';
import { BuildTorusTool } from './tools/advanced/building/build-torus';
import { BuildHelixTool } from './tools/advanced/building/build-helix';
import { BuildEllipsoidTool } from './tools/advanced/building/build-ellipsoid';
import { BuildRotateTool } from './tools/advanced/building/build-rotate';
import { BuildTransformTool } from './tools/advanced/building/build-transform';

// Socket-BE Core API ツール（推奨）
import { AgentTool } from './tools/core/agent';
import { WorldTool } from './tools/core/world';
import { PlayerTool } from './tools/core/player';
import { BlocksTool } from './tools/core/blocks';
import { SystemTool } from './tools/core/system';
import { CameraTool } from './tools/core/camera';

import { BaseTool } from './tools/base/tool';

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
    public start(port: number = 8001): void {
        this.socketBE = new SocketBE({ port });
        
        // MCPモードでない場合のみstderrにログ出力
        if (process.stdin.isTTY !== false) {
            console.error(`SocketBE Minecraft WebSocketサーバーを起動中 ポート:${port}`);
            console.error(`Minecraftから接続: /connect localhost:${port}/ws`);
        }
        
        this.socketBE.on(ServerEvent.Open, () => {
            if (process.stdin.isTTY !== false) {
                console.error('SocketBEサーバーが開始されました');
            }
            
            // 代替手段: 10秒後に強制的にワールドとエージェントを設定（ワールド登録待ち）
            setTimeout(async () => {
                try {
                    // Socket-BEからワールドを取得
                    const worlds = this.socketBE?.worlds;
                    if (worlds && worlds instanceof Map && worlds.size > 0) {
                        this.currentWorld = Array.from(worlds.values())[0];
                        
                        // エージェントを取得
                        try {
                            if (this.currentWorld) {
                                this.currentAgent = await this.currentWorld.getOrCreateAgent();
                            }
                        } catch (agentError) {
                            // エージェント取得に失敗してもサーバーは継続
                        }
                        
                        // 仮のプレイヤー情報を設定
                        this.connectedPlayer = {
                            ws: null,
                            name: 'MinecraftPlayer',
                            id: uuidv4()
                        };
                        
                        // 全ツールにSocket-BEインスタンスを設定
                        this.tools.forEach(tool => {
                            tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
                        });
                        
                        // Minecraft側に接続確認メッセージを送信
                        try {
                            await this.currentWorld.sendMessage('§a[MCP Server] 接続完了！AIツールが利用可能になりました。');
                        } catch (messageError) {
                            // メッセージ送信失敗は無視
                        }
                    }
                } catch (error) {
                    // 強制設定失敗は無視してサーバー継続
                }
            }, 10000);
            
            // 定期的なワールドチェック（30秒ごと）
            setInterval(async () => {
                if (!this.currentWorld && this.socketBE) {
                    const worlds = this.socketBE.worlds;
                    if (worlds instanceof Map && worlds.size > 0) {
                        this.currentWorld = Array.from(worlds.values())[0];
                        
                        try {
                            if (this.currentWorld) {
                                this.currentAgent = await this.currentWorld.getOrCreateAgent();
                                this.tools.forEach(tool => {
                                    tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
                                });
                                await this.currentWorld.sendMessage('§a[MCP Server] 遅延接続完了！AIツールが利用可能になりました。');
                            }
                        } catch (delayedError) {
                            // 遅延設定失敗は無視
                        }
                    }
                }
            }, 30000);
        });
        
        
        this.socketBE.on(ServerEvent.PlayerJoin, async (ev: any) => {
            if (process.stdin.isTTY !== false) {
                console.error('新しいプレイヤーが参加しました:', ev.player.name);
            }
            
            // Minecraft側に参加確認メッセージを送信
            try {
                await ev.world.sendMessage(`§b[MCP Server] §f${ev.player.name}さん、ようこそ！AIアシスタントが利用可能です。`);
            } catch (messageError) {
                // メッセージ送信失敗は無視
            }
            
            this.connectedPlayer = {
                ws: null, // SocketBEではws直接アクセス不要
                name: ev.player.name || 'unknown',
                id: uuidv4()
            };
            
            this.currentWorld = ev.world;
            
            // エージェントを取得
            try {
                if (this.currentWorld) {
                    this.currentAgent = await this.currentWorld.getOrCreateAgent();
                }
            } catch (error) {
                console.error('Failed to get or create agent:', error);
                this.currentAgent = null;
            }
            
            // 全ツールのSocket-BEインスタンスを更新
            this.tools.forEach(tool => {
                tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
            });
            
        });
        
        this.socketBE.on(ServerEvent.PlayerLeave, (ev: any) => {
            if (process.stdin.isTTY !== false) {
                console.error(`プレイヤーが切断されました: ${ev.player.name}`);
            }
            this.connectedPlayer = null;
            this.currentWorld = null;
            this.currentAgent = null;
            
            // 全ツールのSocket-BEインスタンスをクリア
            this.tools.forEach(tool => {
                tool.setSocketBEInstances(null, null);
            });
        });
        
        // MCP stdin処理
        this.setupMCPInterface();
        
        // ツールの初期化
        this.initializeTools();
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
            
            // Advanced Building ツール（高レベル建築機能）
            new BuildCubeTool(),           // ✅ 完全動作
            new BuildLineTool(),           // ✅ 完全動作
            new BuildSphereTool(),         // ✅ 完全動作
            new BuildCylinderTool(),       // ✅ 修正済み
            new BuildParaboloidTool(),     // ✅ 基本動作
            new BuildHyperboloidTool(),    // ✅ 基本動作
            new BuildRotateTool(),         // ✅ 基本動作
            new BuildTransformTool(),      // ✅ 基本動作
            new BuildTorusTool(),          // ✅ 修正完了
            new BuildHelixTool(),          // ✅ 修正完了  
            new BuildEllipsoidTool(),      // ✅ 修正完了
            
        ];
        
        // 全ツールにコマンド実行関数とSocket-BEインスタンスを設定
        const commandExecutor = async (command: string): Promise<ToolCallResult> => {
            return this.executeCommand(command);
        };
        
        this.tools.forEach(tool => {
            tool.setCommandExecutor(commandExecutor);
            tool.setSocketBEInstances(this.currentWorld, this.currentAgent);
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
                console.error('エラー: プレイヤーが接続されていません');
            }
            return { success: false, message: 'No player connected' };
        }
        
        try {
            if (process.stdin.isTTY !== false) {
                console.error(`メッセージ送信: ${text}`);
            }
            
            await this.currentWorld.sendMessage(text);
            return { success: true, message: 'Message sent successfully' };
        } catch (error) {
            if (process.stdin.isTTY !== false) {
                console.error('メッセージ送信エラー:', error);
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
            return { success: false, message: 'No player connected' };
        }
        
        try {
            const result = await this.currentWorld.runCommand(command);
            
            // レスポンスをlastCommandResponseに保存（位置情報取得などで使用）
            this.lastCommandResponse = result;
            
            return { 
                success: true, 
                message: 'Command executed successfully',
                data: result
            };
        } catch (error) {
            return { 
                success: false, 
                message: `Command execution failed: ${error}`
            };
        }
    }

    /**
     * 最新のコマンドレスポンスを取得します（位置情報など）
     */
    public getLastCommandResponse(): any {
        return this.lastCommandResponse;
    }

    
    /**
     * MCPインターフェースを設定します
     * Claude Desktop等のMCPクライアントとの通信を初期化
     */
    private setupMCPInterface(): void {
        // Claude Desktop用にMCPインターフェースを常に設定
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', async (data: string) => {
            const line = data.toString().trim();
            if (!line) return;
            
            try {
                const request: MCPRequest = JSON.parse(line);
                const response = await this.handleMCPRequest(request);
                
                // 通知以外の全リクエストに対して即座にレスポンスを送信
                if (response !== null) {
                    process.stdout.write(JSON.stringify(response) + '\n');
                }
            } catch (error) {
                // 無効なJSONに対するエラーレスポンスを送信
                if (line.includes('"id"')) {
                    try {
                        const partialRequest = JSON.parse(line);
                        if (partialRequest.id !== undefined) {
                            const errorResponse: MCPResponse = {
                                jsonrpc: '2.0',
                                id: partialRequest.id,
                                error: {
                                    code: -32700,
                                    message: 'Parse error'
                                }
                            };
                            process.stdout.write(JSON.stringify(errorResponse) + '\n');
                        }
                    } catch (e) {
                        // IDを抽出できない場合は無視
                    }
                }
            }
        });
    }
    
    /**
     * MCPリクエストを処理します
     * 
     * JSON-RPC 2.0形式のリクエストを解析し、適切なレスポンスを生成します。
     * 
     * @param request - MCPリクエスト
     * @returns MCPレスポンス（通知の場合はnull）
     * @internal
     */
    private async handleMCPRequest(request: MCPRequest): Promise<MCPResponse | null> {
        switch (request.method) {
            case 'notifications/initialized':
            case 'notifications/cancelled':
                // 通知はレスポンスが不要
                return null;
                
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: {
                            name: 'mcbk-mcp-typescript',
                            version: '1.0.0'
                        }
                    }
                };
                
            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: this.getTools()
                    }
                };
                
            case 'tools/call':
                return await this.handleToolCall(request);
                
            case 'resources/list':
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        resources: []
                    }
                };
                
            case 'prompts/list':
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        prompts: []
                    }
                };
                
            default:
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: { code: -32601, message: 'Method not found' }
                };
        }
    }
    
    /**
     * 利用可能なツール一覧を取得します
     * MCPクライアントにツール情報を提供
     * @returns ツール定義の配列
     */
    private getTools(): Tool[] {
        const basicTools: Tool[] = [
            {
                name: 'send_message',
                description: 'Send a chat message to the connected Minecraft player. ALWAYS provide a message parameter. Use this to communicate with the player about build progress or instructions.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            description: 'The text message to send to the player (REQUIRED - never call this without a message)'
                        }
                    },
                    required: ['message']
                }
            },
            {
                name: 'execute_command',
                description: 'Execute a Minecraft command',
                inputSchema: {
                    type: 'object',
                    properties: {
                        command: {
                            type: 'string',
                            description: 'The Minecraft command to execute'
                        }
                    },
                    required: ['command']
                }
            }
        ];
        
        // モジュラーツールを追加
        const modularTools: Tool[] = this.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
        }));
        
        return [...basicTools, ...modularTools];
    }
    
    /**
     * ツール実行リクエストを処理します
     * MCPクライアントからのツール呼び出しを受け取り、適切なツールに委譲
     * @param request - MCPツール実行リクエスト
     * @returns ツール実行結果のMCPレスポンス
     */
    private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
        try {
            const toolName = request.params?.name;
            const args = request.params?.arguments || request.params?.args || {};
            
            if (!toolName) {
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: { code: -32602, message: 'Missing tool name' }
                };
            }

            let result: ToolCallResult;
        
            // 基本ツールの処理
            if (toolName === 'send_message') {
                // メッセージパラメータの処理
                const message = args.message || args.text || 'Hello from MCP server!';
                
                if (!message || message.trim() === '') {
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: { code: -32602, message: 'Message parameter is required and cannot be empty' }
                    };
                }
                result = await this.sendMessage(message);
        } else if (toolName === 'execute_command') {
            result = await this.executeCommand(args.command);
        } else {
            // モジュラーツールの処理
            const tool = this.tools.find(t => t.name === toolName);
            if (!tool) {
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: { code: -32603, message: `Unknown tool: ${toolName}` }
                };
            }
            
            try {
                result = await tool.execute(args);
            } catch (error) {
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: { 
                        code: -32603, 
                        message: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}` 
                    }
                };
            }
        }
        
        if (!result.success) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: { code: -32603, message: result.message || 'Tool execution failed' }
            };
        }
        
            return {
                jsonrpc: '2.0',
                id: request.id,
                result: {
                    content: [{
                        type: 'text',
                        text: result.data ? 
                            `${result.message || `Tool ${toolName} executed successfully`}\n\nData: ${JSON.stringify(result.data, null, 2)}` :
                            result.message || `Tool ${toolName} executed successfully`
                    }]
                }
            };
        } catch (error) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: { 
                    code: -32603, 
                    message: `Tool call handler error: ${error instanceof Error ? error.message : String(error)}` 
                }
            };
        }
    }
}

// サーバーを開始
const server = new MinecraftMCPServer();

// ポート番号をコマンドライン引数から取得
const getPort = (): number => {
    // コマンドライン引数から取得 (--port=8002)
    const portArg = process.argv.find(arg => arg.startsWith('--port='));
    if (portArg) {
        const port = parseInt(portArg.split('=')[1]);
        if (!isNaN(port) && port > 0 && port <= 65535) {
            return port;
        }
    }
    
    // デフォルト値
    return 8001;
};

const port = getPort();
server.start(port);

process.on('SIGINT', () => {
    process.exit(0);
});