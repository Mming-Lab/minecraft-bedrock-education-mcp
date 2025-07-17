import { Tool, InputSchema, ToolCallResult } from '../../types';

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
     * コマンド実行関数の設定
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

        for (const [index, command] of commands.entries()) {
            const result = await this.executeCommand(command);
            
            if (!result.success) {
                hasError = true;
                
                if (stopOnError) {
                    return { 
                        success: false, 
                        message: `Batch execution failed at command ${index + 1}: ${result.message}` 
                    };
                }
            }
            
            results.push(result);
        }

        return {
            success: !hasError,
            message: `Batch execution completed. Successful: ${results.filter(r => r.success).length}, Failed: ${results.filter(r => !r.success).length}`,
            data: {
                results,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length
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

