import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { executeBuildWithOptimization } from '../../../utils/integration/build-executor';
import { calculateCubePositions } from '../../../utils/geometry';
import { DirectionalParams } from '../../../utils/integration/rotation-transformer';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';

/**
 * 立方体構造物を建築するツール
 * 
 * @description
 * 指定された2点間に立方体または中空立方体を建築します。
 * 大量のブロック操作に対するボリューム制限（最大32768ブロック）があり、
 * 安全性とパフォーマンスを確保します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildCubeTool();
 * 
 * // 実体の石の立方体を建築
 * await tool.execute({
 *   x1: 0, y1: 64, z1: 0,
 *   x2: 10, y2: 74, z2: 10,
 *   material: "stone",
 *   hollow: false
 * });
 * 
 * // 中空のガラスの立方体を建築
 * await tool.execute({
 *   x1: 20, y1: 64, z1: 20,
 *   x2: 30, y2: 80, z2: 30,
 *   material: "glass",
 *   hollow: true
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildCubeTool extends BaseTool {
    readonly name = 'build_cube';
    readonly description = 'Build CUBE/RECTANGLE: box, rectangle, wall, platform, room, house frame. Define with 2 corners (x1,y1,z1) to (x2,y2,z2). Coordinates can be positive or negative (e.g. x:-50, z:-100). Supports sequences for automation.';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Build action to perform',
                enum: ['build'],
                default: 'build'
            },
            x1: {
                type: 'number',
                description: 'Starting X coordinate (east-west, can be negative like -50)'
            },
            y1: {
                type: 'number',
                description: 'Starting Y coordinate (height, usually 64-100 for ground level)'
            },
            z1: {
                type: 'number',
                description: 'Starting Z coordinate (north-south, can be negative like -100)'
            },
            x2: {
                type: 'number',
                description: 'Ending X coordinate (east-west, can be negative)'
            },
            y2: {
                type: 'number',
                description: 'Ending Y coordinate (height, can be higher than y1 for tall structures)'
            },
            z2: {
                type: 'number',
                description: 'Ending Z coordinate (north-south, can be negative)'
            },
            material: {
                type: 'string',
                description: 'Block material to use',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Create hollow cube (default: false)',
                default: false
            },
            direction: {
                type: 'string',
                description: 'Orientation direction: +x, +y, +z, -x, -y, -z, or custom for advanced rotation',
                enum: ['+x', '+y', '+z', '-x', '-y', '-z', 'custom'],
                default: '+y'
            }
        },
        required: ['x1', 'y1', 'z1', 'x2', 'y2', 'z2']
    };

    /**
     * 立方体構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.x1 - 開始点のX座標
     * @param args.y1 - 開始点のY座標
     * @param args.z1 - 開始点のZ座標
     * @param args.x2 - 終了点のX座標
     * @param args.y2 - 終了点のY座標
     * @param args.z2 - 終了点のZ座標
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.hollow - 中空にするかどうか（デフォルト: false）
     * @returns 建築実行結果
     * 
     * @throws Y座標が範囲外の場合
     * @throws ボリュームが制限を超える場合（32768ブロック超過）
     * 
     * @example
     * ```typescript
     * // 小さな石の家を建築
     * const result = await tool.execute({
     *   x1: 0, y1: 64, z1: 0,
     *   x2: 5, y2: 68, z2: 5,
     *   material: "cobblestone",
     *   hollow: true
     * });
     * 
     * if (result.success) {
     *   console.log(`建築完了: ${result.data.volume}ブロック使用`);
     * }
     * ```
     */
    async execute(args: {
        action?: string;
        x1: number;
        y1: number;
        z1: number;
        x2: number;
        y2: number;
        z2: number;
        material?: string;
        hollow?: boolean;
        direction?: string;
    }): Promise<ToolCallResult> {
        try {
            const { action = 'build', x1, y1, z1, x2, y2, z2, material = 'minecraft:stone', hollow = false, direction = '+y' } = args;
            
            // actionパラメータをサポート（現在は build のみ）
            if (action !== 'build') {
                return this.createErrorResponse(`Unknown action: ${action}. Only 'build' is supported.`);
            }
            
            // 座標の整数化
            const coords = {
                x1: Math.floor(x1),
                y1: Math.floor(y1),
                z1: Math.floor(z1),
                x2: Math.floor(x2),
                y2: Math.floor(y2),
                z2: Math.floor(z2)
            };
            
            // Y座標の検証
            if (coords.y1 < -64 || coords.y1 > 320 || coords.y2 < -64 || coords.y2 > 320) {
                return {
                    success: false,
                    message: 'Y coordinates must be between -64 and 320'
                };
            }
            
            // 範囲の検証
            const volume = Math.abs(coords.x2 - coords.x1 + 1) * Math.abs(coords.y2 - coords.y1 + 1) * Math.abs(coords.z2 - coords.z1 + 1);
            if (volume > 32768) {
                return {
                    success: false,
                    message: 'Volume too large (maximum 32768 blocks)'
                };
            }
            
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: 'World not available. Ensure Minecraft is connected.' };
            }

            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }

            try {
                // 立方体の座標を計算
                const corner1 = { x: coords.x1, y: coords.y1, z: coords.z1 };
                const corner2 = { x: coords.x2, y: coords.y2, z: coords.z2 };
                const positions = calculateCubePositions(corner1, corner2, hollow);
                
                // 大きな立方体の場合は制限（最適化効果を考慮）
                if (positions.length > BUILD_LIMITS.CUBE) {
                    return {
                        success: false,
                        message: `Too many blocks to place (maximum ${BUILD_LIMITS.CUBE.toLocaleString()})`
                    };
                }
                
                // 方向指定パラメータ
                const directionalParams: DirectionalParams = {
                    direction: direction as any
                };
                
                // 最適化されたビルド実行（回転対応）
                const result = await executeBuildWithOptimization(
                    this.world,
                    positions,
                    blockId,
                    {
                        type: 'cube',
                        from: corner1,
                        to: corner2,
                        material: blockId,
                        hollow: hollow,
                        direction: direction,
                        apiUsed: 'Socket-BE'
                    },
                    directionalParams
                );
                
                return result;
            } catch (buildError) {
                return {
                    success: false,
                    message: `Building error: ${buildError instanceof Error ? buildError.message : String(buildError)}`
                };
            }

        } catch (error) {
            return {
                success: false,
                message: `Error building cube: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}