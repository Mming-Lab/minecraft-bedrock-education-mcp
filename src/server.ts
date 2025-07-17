import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
    MCPRequest,
    MCPResponse,
    Tool,
    MinecraftMessage,
    MinecraftCommandRequest,
    MinecraftCommandResponse,
    MinecraftEncryptRequest,
    MinecraftEncryptResponse,
    ConnectedPlayer,
    ToolCallResult
} from './types';
// レベル1: 基本操作ツール
import { PlayerPositionTool } from './tools/player/player-position';
import { PlayerMoveTool } from './tools/player/player-move';
import { PlayerSayTool } from './tools/player/player-say';
import { AgentMoveTool } from './tools/agent/agent-move';
import { AgentTurnTool } from './tools/agent/agent-turn';
import { AgentAttackTool } from './tools/agent/agent-attack';
import { AgentBlockActionTool } from './tools/agent/agent-block-action';
import { WorldBlockTool } from './tools/world/world-block';

// レベル2: 複合操作ツール
import { BuildCubeTool } from './tools/build/build-cube';
import { BuildLineTool } from './tools/build/build-line';
import { BuildSphereTool } from './tools/build/build-sphere';
import { WorldFillTool } from './tools/world/world-fill';
import { WorldTimeWeatherTool } from './tools/world/world-time-weather';

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
    private wss: WebSocketServer | null = null;
    private tools: BaseTool[] = [];

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
        this.wss = new WebSocketServer({ port });
        
        // MCPモードでない場合のみstderrにログ出力
        if (process.stdin.isTTY !== false) {
            console.error(`TypeScript Minecraft WebSocketサーバーを起動中 ポート:${port}`);
            console.error(`Minecraftから接続: /connect localhost:${port}/ws`);
        }
        
        this.wss.on('connection', (ws: WebSocket, req) => {
            if (process.stdin.isTTY !== false) {
                console.error('新しいWebSocket接続が確立されました');
            }
            
            this.connectedPlayer = {
                ws: ws,
                name: 'unknown',
                id: uuidv4()
            };
            
            ws.on('message', (data: Buffer) => {
                try {
                    const message: MinecraftMessage = JSON.parse(data.toString());
                    this.handleMinecraftMessage(ws, message);
                } catch (error) {
                    if (process.stdin.isTTY !== false) {
                        console.error('JSON以外のメッセージを受信:', data.toString());
                    }
                }
            });
            
            ws.on('close', (code: number, reason: Buffer) => {
                if (process.stdin.isTTY !== false) {
                    console.error(`プレイヤーが切断されました: code=${code}, reason=${reason.toString()}`);
                }
                this.connectedPlayer = null;
            });
            
            ws.on('error', (error: Error) => {
                if (process.stdin.isTTY !== false) {
                    console.error('WebSocketエラー:', error);
                }
            });
            
            // 接続後にプレイヤー情報をリクエスト
            setTimeout(() => {
                if (this.connectedPlayer) {
                    const getPlayerMessage: MinecraftCommandRequest = {
                        header: {
                            version: 1,
                            requestId: 'getplayer-' + uuidv4(),
                            messagePurpose: 'commandRequest'
                        },
                        body: {
                            origin: { type: 'player' },
                            commandLine: 'getlocalplayername',
                            version: 1
                        }
                    };
                    
                    ws.send(JSON.stringify(getPlayerMessage));
                    
                    // 自動レスポンステストの実行
                    const autoTest = process.argv.includes('--auto-test') || process.env.AUTO_RESPONSE_TEST === 'true';
                    console.error(`DEBUG: 自動テストフラグ = ${autoTest}`);
                    if (autoTest) {
                        console.error('自動レスポンステストを開始します...');
                        setTimeout(() => {
                            this.runResponseTests().catch(error => {
                                console.error('自動テストエラー:', error);
                            });
                        }, 2000); // 接続安定化のため少し待機
                    } else {
                        console.error('自動レスポンステストは無効です');
                    }
                }
            }, 1000);
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
            // レベル1: 基本操作ツール
            new PlayerPositionTool(),
            new PlayerMoveTool(),
            new PlayerSayTool(),
            new AgentMoveTool(),
            new AgentTurnTool(),
            new AgentAttackTool(),
            new AgentBlockActionTool(),
            new WorldBlockTool(),
            
            // レベル2: 複合操作ツール
            new BuildCubeTool(),
            new BuildLineTool(),
            new BuildSphereTool(),
            new WorldFillTool(),
            new WorldTimeWeatherTool()
        ];
        
        // 全ツールにコマンド実行関数を設定
        const commandExecutor = async (command: string): Promise<ToolCallResult> => {
            return this.executeCommand(command);
        };
        
        this.tools.forEach(tool => {
            tool.setCommandExecutor(commandExecutor);
        });
    }
    
    private lastCommandResponse: any = null;

    private handleMinecraftMessage(ws: WebSocket, message: MinecraftMessage): void {
        if (message.header?.messagePurpose === 'ws:encrypt') {
            if (process.stdin.isTTY !== false) {
                console.error('=== 暗号化処理中 ===');
            }
            
            const encryptResponse: MinecraftEncryptResponse = {
                header: {
                    version: 1,
                    requestId: message.header.requestId || uuidv4(),
                    messagePurpose: 'ws:encrypt'
                },
                body: {
                    publicKey: ''  // 空キーは暗号化なしを意味
                }
            };
            
            ws.send(JSON.stringify(encryptResponse));
            return;
        }
        
        if (message.header?.messagePurpose === 'commandResponse') {
            if (process.stdin.isTTY !== false) {
                console.error('コマンドレスポンス受信:');
                console.error('リクエストID:', message.header.requestId);
                console.error('ステータスコード:', (message.body as any)?.statusCode);
                console.error('ステータスメッセージ:', (message.body as any)?.statusMessage);
                console.error('完全なレスポンス:', JSON.stringify(message, null, 2));
            }
            
            // プレイヤー名が利用可能な場合は更新
            const commandResponse = message as MinecraftCommandResponse;
            if (commandResponse.body?.localplayername && this.connectedPlayer) {
                this.connectedPlayer.name = commandResponse.body.localplayername;
                if (process.stdin.isTTY !== false) {
                    console.error(`プレイヤーを識別: ${this.connectedPlayer.name}`);
                }
            }
            
            // 最新のコマンドレスポンスを保存（位置情報取得用）
            this.lastCommandResponse = commandResponse.body;
        }
    }
    
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
    public sendMessage(text: string): ToolCallResult {
        if (!this.connectedPlayer?.ws) {
            if (process.stdin.isTTY !== false) {
                console.error('エラー: プレイヤーが接続されていません');
            }
            return { success: false, message: 'No player connected' };
        }
        
        const requestId = uuidv4();
        const message: MinecraftCommandRequest = {
            header: {
                version: 1,
                requestId: requestId,
                messagePurpose: 'commandRequest'
            },
            body: {
                origin: { type: 'player' },
                commandLine: `say ${text}`,
                version: 1
            }
        };
        
        if (process.stdin.isTTY !== false) {
            console.error(`メッセージ送信: ${text}`);
            console.error(`コマンド: say ${text}`);
            console.error(`リクエストID: ${requestId}`);
            console.error('完全なメッセージ:', JSON.stringify(message, null, 2));
        }
        
        this.connectedPlayer.ws.send(JSON.stringify(message));
        return { success: true, message: 'Message sent successfully' };
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
        if (!this.connectedPlayer?.ws) {
            return { success: false, message: 'No player connected' };
        }
        
        const requestId = uuidv4();
        const message: MinecraftCommandRequest = {
            header: {
                version: 1,
                requestId: requestId,
                messagePurpose: 'commandRequest'
            },
            body: {
                origin: { type: 'player' },
                commandLine: command,
                version: 1
            }
        };
        
        // querytargetコマンドの場合は特別なレスポンス処理
        if (command.startsWith('querytarget')) {
            return new Promise((resolve) => {
                // レスポンス待機用のタイムアウト
                const timeout = setTimeout(() => {
                    resolve({
                        success: false,
                        message: 'QueryTarget command timed out'
                    });
                }, 5000);
                
                // 一時的なレスポンスハンドラーを設定
                const originalHandler = this.lastCommandResponse;
                
                // レスポンス監視
                const checkResponse = () => {
                    if (this.lastCommandResponse && this.lastCommandResponse !== originalHandler) {
                        clearTimeout(timeout);
                        const responseData = this.lastCommandResponse;
                        
                        resolve({
                            success: true,
                            message: 'QueryTarget command executed',
                            data: responseData
                        });
                    } else {
                        // まだレスポンスが来ていない場合は再チェック
                        setTimeout(checkResponse, 100);
                    }
                };
                
                // コマンド送信
                this.connectedPlayer!.ws.send(JSON.stringify(message));
                
                // レスポンス監視開始
                setTimeout(checkResponse, 100);
            });
        } else {
            // 通常のコマンド処理
            this.connectedPlayer.ws.send(JSON.stringify(message));
            return { 
                success: true, 
                message: 'Command executed successfully',
                data: { requestId: requestId }
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
     * Minecraft接続セッション内で自動レスポンステストを実行
     */
    private async runResponseTests(): Promise<void> {
        console.error('\n=== 自動レスポンステスト開始 ===');
        
        // プレイヤー名を取得（@sの代わりに使用）
        const playerName = this.connectedPlayer?.name || '@p';
        
        const testCommands = [
            { name: 'QueryTarget', cmd: 'querytarget @s', critical: true },
            { name: 'TestFor', cmd: 'testfor @s', critical: true },
            { name: 'TimeQuery', cmd: 'time query daytime', critical: false },
            { name: 'List', cmd: 'list', critical: false }
        ];
        
        let testResults: any[] = [];
        
        for (const test of testCommands) {
            try {
                console.error(`\n📋 ${test.name} テスト実行中...`);
                
                const result = await this.executeCommand(test.cmd);
                
                // レスポンス詳細検証
                let isSuccess = false;
                let errorReason = '';
                
                if (result.success && result.data) {
                    // ステータスコードによる成功判定
                    const statusCode = result.data.statusCode;
                    
                    if (typeof statusCode === 'number') {
                        if (statusCode >= 0) {
                            isSuccess = true;
                        } else {
                            errorReason = `エラーステータス: ${statusCode}`;
                        }
                    } else {
                        // ステータスコードがない場合は基本的に成功扱い（QueryTargetなど）
                        isSuccess = true;
                    }
                    
                    // 成功した場合の詳細表示
                    if (isSuccess) {
                        console.error(`✅ ${test.name}: 成功`);
                        
                        // QueryTargetの特別な検証
                        if (test.name === 'QueryTarget') {
                            try {
                                const details = result.data.details || result.data.statusMessage;
                                if (details) {
                                    const playerData = JSON.parse(details);
                                    if (Array.isArray(playerData) && playerData[0]?.position) {
                                        const pos = playerData[0].position;
                                        console.error(`   位置: X=${pos.x}, Y=${pos.y}, Z=${pos.z}`);
                                        console.error(`   回転: ${playerData[0].yRot}°`);
                                    } else {
                                        console.error(`   ⚠️ 位置データの解析に失敗`);
                                        isSuccess = false;
                                        errorReason = '位置データ解析失敗';
                                    }
                                } else {
                                    isSuccess = false;
                                    errorReason = 'QueryTargetレスポンスにdetailsなし';
                                }
                            } catch (e) {
                                console.error(`   ❌ JSON解析エラー: ${e instanceof Error ? e.message : String(e)}`);
                                isSuccess = false;
                                errorReason = 'JSON解析エラー';
                            }
                        } else {
                            // 他のコマンドの基本情報表示
                            if (result.data.statusCode !== undefined) {
                                console.error(`   ステータス: ${result.data.statusCode}`);
                                if (result.data.statusMessage) {
                                    console.error(`   メッセージ: ${result.data.statusMessage}`);
                                }
                            }
                        }
                    } else {
                        console.error(`❌ ${test.name}: 失敗 - ${errorReason}`);
                        if (result.data.statusMessage) {
                            console.error(`   エラー詳細: ${result.data.statusMessage}`);
                        }
                    }
                    
                    testResults.push({ 
                        test: test.name, 
                        success: isSuccess, 
                        data: result.data,
                        error: isSuccess ? undefined : errorReason
                    });
                } else {
                    console.error(`❌ ${test.name}: 失敗 - ${result.message}`);
                    testResults.push({ 
                        test: test.name, 
                        success: false, 
                        error: result.message 
                    });
                }
                
                // テスト間隔
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`❌ ${test.name}: エラー - ${error instanceof Error ? error.message : String(error)}`);
                testResults.push({ 
                    test: test.name, 
                    success: false, 
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        
        // テスト結果サマリー
        const passed = testResults.filter(r => r.success).length;
        const total = testResults.length;
        const successRate = ((passed / total) * 100).toFixed(1);
        
        console.error('\n=== テスト結果サマリー ===');
        console.error(`成功率: ${successRate}% (${passed}/${total})`);
        
        const criticalFailed = testResults.filter(r => 
            !r.success && testCommands.find(t => t.name === r.test)?.critical
        );
        
        if (criticalFailed.length > 0) {
            console.error('⚠️ 重要なコマンドが失敗しています:');
            criticalFailed.forEach(f => console.error(`  - ${f.test}`));
        }
        
        console.error('=== レスポンステスト完了 ===\n');
    }
    
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
                
            default:
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: { code: -32601, message: 'Method not found' }
                };
        }
    }
    
    private getTools(): Tool[] {
        const basicTools: Tool[] = [
            {
                name: 'send_message',
                description: 'Send a message to the connected Minecraft player',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            description: 'The message to send to the player'
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
    
    private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
        const { name: toolName, arguments: args } = request.params;
        
        let result: ToolCallResult;
        
        // 基本ツールの処理
        if (toolName === 'send_message') {
            result = this.sendMessage(args.message);
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
                    text: result.message || `Tool ${toolName} executed successfully`
                }]
            }
        };
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