import { Tool, InputSchema, ToolCallResult } from '../../types';
import { World, Agent } from 'socket-be';

/**
 * シーケンス内の単一ステップを表すインターフェース
 */
export interface SequenceStep {
    type: string;
    [key: string]: any;
    wait_time?: number;
    on_error?: 'continue' | 'stop' | 'retry';
    retry_count?: number;
}

/**
 * 全てのMinecraft制御ツールの抽象基底クラス
 * 
 * @description
 * このクラスは、Minecraft Bedrock Edition制御用の全ツールの共通基盤を提供します。
 * MCP（Model Context Protocol）仕様に準拠したツールインターフェースを実装し、
 * コマンド実行、引数検証、エラーハンドリングなどの共通機能を提供します。
 * 
 * @abstract
 * @implements {Tool}
 * 
 * @example
 * ```typescript
 * export class CustomTool extends BaseTool {
 *   readonly name = 'custom_tool';
 *   readonly description = 'カスタムツールの説明';
 *   readonly inputSchema = { ... };
 *   
 *   async execute(args: any): Promise<ToolCallResult> {
 *     // ツールの実装
 *     return this.createSuccessResponse("実行完了");
 *   }
 * }
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export abstract class BaseTool implements Tool {
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly inputSchema: InputSchema;
    
    protected world: World | null = null;
    protected agent: Agent | null = null;
    private commandExecutor?: (command: string) => Promise<ToolCallResult>;

    constructor() {}

    /**
     * ツールの実行メソッド（各ツールで実装）
     * 
     * @param args - ツール固有の引数オブジェクト
     * @returns ツール実行結果を含むPromise
     * 
     * @abstract
     * @example
     * ```typescript
     * const result = await tool.execute({ x: 100, y: 64, z: 200 });
     * if (result.success) {
     *   console.log("実行成功:", result.message);
     * }
     * ```
     */
    abstract execute(args: any): Promise<ToolCallResult>;

    /**
     * ツール引数のバリデーションを実行します
     * 
     * @param args - 検証する引数オブジェクト
     * @returns バリデーション結果（true: 有効、false: 無効）
     * 
     * @protected
     * @example
     * ```typescript
     * if (!this.validateArgs(args)) {
     *   return this.createErrorResponse("引数が無効です");
     * }
     * ```
     */
    protected validateArgs(args: any): boolean {
        try {
            // 基本的なバリデーションロジック
            if (!args || typeof args !== 'object') {
                return false;
            }

            // 必須フィールドの確認
            const required = this.inputSchema.required || [];
            for (const field of required) {
                if (!(field in args)) {
                    return false;
                }
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Socket-BE World/Agentインスタンスの設定
     */
    public setSocketBEInstances(world: World | null, agent: Agent | null): void {
        this.world = world;
        this.agent = agent;
    }

    /**
     * コマンド実行関数の設定（後方互換性のため）
     */
    public setCommandExecutor(executor: (command: string) => Promise<ToolCallResult>): void {
        this.commandExecutor = executor;
    }

    /**
     * 単一Minecraftコマンドを実行します
     * 
     * @param command - 実行するMinecraftコマンド（"/"プレフィックスなし）
     * @returns コマンド実行結果
     * 
     * @protected
     * @example
     * ```typescript
     * const result = await this.executeCommand("setblock 0 64 0 minecraft:stone");
     * ```
     */
    protected async executeCommand(command: string): Promise<ToolCallResult> {
        if (!this.commandExecutor) {
            return { success: false, message: 'Command executor not set' };
        }
        
        try {
            return await this.commandExecutor(command);
        } catch (error) {
            return { 
                success: false, 
                message: `Command execution error: ${error instanceof Error ? error.message : String(error)}` 
            };
        }
    }

    /**
     * 複数のMinecraftコマンドをバッチ実行します
     * 
     * @param commands - 実行するコマンドの配列
     * @param stopOnError - エラー時に実行を停止するかどうか（デフォルト: true）
     * @returns バッチ実行結果
     * 
     * @protected
     * @example
     * ```typescript
     * const commands = [
     *   "setblock 0 64 0 minecraft:stone",
     *   "setblock 1 64 0 minecraft:dirt"
     * ];
     * const result = await this.executeBatch(commands);
     * ```
     */
    protected async executeBatch(commands: string[], stopOnError: boolean = true): Promise<ToolCallResult> {
        const results: any[] = [];
        let hasError = false;
        const totalCommands = commands.length;
        const batchSize = 50; // バッチサイズを小分け
        
        // 大量コマンドの場合は進捗報告
        const shouldReportProgress = totalCommands > 100;
        
        for (let batchStart = 0; batchStart < totalCommands; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, totalCommands);
            const currentBatch = commands.slice(batchStart, batchEnd);
            
            // 進捗報告
            if (shouldReportProgress && batchStart > 0) {
                const progress = Math.round((batchStart / totalCommands) * 100);
                console.error(`Building progress: ${progress}% (${batchStart}/${totalCommands} blocks)`);
            }
            
            // バッチ内のコマンドを実行
            for (const [localIndex, command] of currentBatch.entries()) {
                const globalIndex = batchStart + localIndex;
                const result = await this.executeCommand(command);
                
                if (!result.success) {
                    hasError = true;
                    
                    if (stopOnError) {
                        return { 
                            success: false, 
                            message: `Batch execution failed at command ${globalIndex + 1}: ${result.message}` 
                        };
                    }
                }
                
                results.push(result);
                
                // 適度な間隔で処理を分散（サーバー負荷軽減）
                if ((globalIndex + 1) % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }
            
            // バッチ間で少し待機（サーバー安定化）
            if (batchEnd < totalCommands) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        return {
            success: !hasError,
            message: `Batch execution completed. Successful: ${successful}, Failed: ${failed}`,
            data: {
                results,
                successful,
                failed,
                totalCommands
            }
        };
    }

    /**
     * 座標を正規化します（小数点以下切り捨て）
     * 
     * @param coord - 正規化する座標値
     * @returns 正規化された整数座標
     * 
     * @protected
     * @example
     * ```typescript
     * const x = this.normalizeCoordinate(100.7); // 結果: 100
     * ```
     */
    protected normalizeCoordinate(coord: number): number {
        return Math.floor(coord);
    }

    /**
     * Minecraft座標の有効性を検証します
     * 
     * @param x - X座標
     * @param y - Y座標（-64〜320の範囲内である必要があります）
     * @param z - Z座標
     * @returns 座標が有効かどうか
     * 
     * @protected
     * @example
     * ```typescript
     * if (!this.validateCoordinates(x, y, z)) {
     *   return this.createErrorResponse("座標が無効です");
     * }
     * ```
     */
    protected validateCoordinates(x: number, y: number, z: number): boolean {
        // Minecraft座標の基本的な制限
        const MAX_COORD = 30000000;
        const MIN_Y = -64;
        const MAX_Y = 320;

        return (
            Math.abs(x) <= MAX_COORD &&
            Math.abs(z) <= MAX_COORD &&
            y >= MIN_Y &&
            y <= MAX_Y
        );
    }

    /**
     * ブロックIDの正規化
     */
    protected normalizeBlockId(blockId: string): string {
        // minecraft: プレフィックスの統一
        if (!blockId.includes(':')) {
            return `minecraft:${blockId}`;
        }
        return blockId.toLowerCase();
    }

    /**
     * エラーレスポンスの生成
     */
    protected createErrorResponse(message: string): ToolCallResult {
        return { success: false, message };
    }

    /**
     * 成功レスポンスの生成
     */
    protected createSuccessResponse(message?: string, data?: any): ToolCallResult {
        return { success: true, message, data };
    }

    /**
     * シーケンス実行の基底実装
     * 各ツールで具体的なステップ実行をオーバーライドできます
     * 
     * @param steps - 実行するステップの配列
     * @returns シーケンス実行結果
     * 
     * @protected
     * @example
     * ```typescript
     * const steps = [
     *   { type: 'move', x: 100, y: 64, z: 200, wait_time: 1 },
     *   { type: 'place', block: 'stone', wait_time: 0.5 }
     * ];
     * const result = await this.executeSequence(steps);
     * ```
     */
    protected async executeSequence(steps: SequenceStep[]): Promise<ToolCallResult> {
        if (!steps || !Array.isArray(steps) || steps.length === 0) {
            return this.createErrorResponse('Steps array is required for sequence execution');
        }

        try {
            let totalDuration = 0;
            const results: string[] = [];
            
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const stepResult = await this.executeSequenceStep(step, i);
                
                if (!stepResult.success) {
                    const errorAction = step.on_error || 'stop';
                    
                    switch (errorAction) {
                        case 'continue':
                            results.push(`Step ${i + 1}: Failed but continuing - ${stepResult.message}`);
                            break;
                        case 'retry':
                            const retryResult = await this.retrySequenceStep(step, i);
                            if (!retryResult.success) {
                                return this.createErrorResponse(`Step ${i + 1} failed after retries: ${retryResult.message}`);
                            }
                            results.push(`Step ${i + 1}: Succeeded after retry - ${retryResult.message}`);
                            break;
                        case 'stop':
                        default:
                            return this.createErrorResponse(`Step ${i + 1} failed: ${stepResult.message}`);
                    }
                } else {
                    results.push(`Step ${i + 1}: ${stepResult.message || 'Executed'}`);
                }
                
                // 待ち時間処理
                const waitTime = step.wait_time || 0;
                if (waitTime > 0 && i < steps.length - 1) {
                    await this.delay(waitTime);
                    totalDuration += waitTime;
                }
            }
            
            return this.createSuccessResponse(
                `Sequence completed: ${steps.length} steps executed over ${totalDuration.toFixed(1)}s\n` +
                results.join('\n')
            );
            
        } catch (error) {
            return this.createErrorResponse(`Sequence execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * シーケンス内の単一ステップを実行します
     * 各ツールで具体的な実装をオーバーライドする必要があります
     * 
     * @param step - 実行するステップ
     * @param index - ステップのインデックス
     * @returns ステップ実行結果
     * 
     * @protected
     * @virtual
     */
    protected async executeSequenceStep(step: SequenceStep, index: number): Promise<ToolCallResult> {
        // デフォルト実装: wait以外は各ツールでオーバーライド必要
        if (step.type === 'wait') {
            const waitTime = step.wait_time || 1;
            await this.delay(waitTime);
            return this.createSuccessResponse(`Waited ${waitTime}s`);
        }
        
        return this.createErrorResponse(`Unknown step type: ${step.type}. Override executeSequenceStep in your tool.`);
    }

    /**
     * 失敗したステップをリトライします
     * 
     * @param step - リトライするステップ
     * @param index - ステップのインデックス
     * @returns リトライ結果
     * 
     * @protected
     */
    protected async retrySequenceStep(step: SequenceStep, index: number): Promise<ToolCallResult> {
        const maxRetries = step.retry_count || 3;
        
        for (let retry = 1; retry <= maxRetries; retry++) {
            if (process.stdin.isTTY !== false) {
                console.error(`Retrying step ${index + 1}, attempt ${retry}/${maxRetries}`);
            }
            
            // 少し待ってからリトライ
            await this.delay(0.5);
            
            const result = await this.executeSequenceStep(step, index);
            if (result.success) {
                return result;
            }
            
            if (retry === maxRetries) {
                return this.createErrorResponse(`Step failed after ${maxRetries} retries: ${result.message}`);
            }
        }
        
        return this.createErrorResponse('Retry logic error');
    }

    /**
     * Promise-based delay utility
     * 
     * @param seconds - 待機時間（秒）
     * @returns Promise
     * 
     * @protected
     */
    protected delay(seconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    /**
     * ツール情報の取得（MCP protocol用）
     */
    public getToolInfo(): Tool {
        return {
            name: this.name,
            description: this.description,
            inputSchema: this.inputSchema
        };
    }
}

