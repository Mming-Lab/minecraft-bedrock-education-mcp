import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

/**
 * 直線構造物を建築するツール
 * 
 * @description
 * 2点間を結ぶ直線状のブロック列を建築します。
 * 道、柱、橋、フェンスなどの線的構造物に最適で、
 * Bresenham線描画アルゴリズムを使用して連続した線を実現します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildLineTool();
 * 
 * // 水平な石の道を建築
 * await tool.execute({
 *   x1: 0, y1: 64, z1: 0,
 *   x2: 20, y2: 64, z2: 0,
 *   material: "stone"
 * });
 * 
 * // 斜めの橋を建築
 * await tool.execute({
 *   x1: 10, y1: 64, z1: 10,
 *   x2: 30, y2: 80, z2: 30,
 *   material: "oak_planks"
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildLineTool extends BaseTool {
    readonly name = 'build_line';
    readonly description = 'Build a straight line of blocks between two points. Perfect for paths, roads, fences, bridges, pillars, or structural frameworks. Example: from (0,64,0) to (10,80,10) creates a diagonal line useful for building supports or artistic structures';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            x1: {
                type: 'number',
                description: 'Starting X coordinate (east-west position where line begins)'
            },
            y1: {
                type: 'number',
                description: 'Starting Y coordinate (height where line begins, typically 64 for ground level)'
            },
            z1: {
                type: 'number',
                description: 'Starting Z coordinate (north-south position where line begins)'
            },
            x2: {
                type: 'number',
                description: 'Ending X coordinate (east-west position where line ends)'
            },
            y2: {
                type: 'number',
                description: 'Ending Y coordinate (height where line ends, can be different for slopes/ramps)'
            },
            z2: {
                type: 'number',
                description: 'Ending Z coordinate (north-south position where line ends)'
            },
            material: {
                type: 'string',
                description: 'Block type to build the line with (e.g. stone, cobblestone, wood, concrete)',
                default: 'minecraft:stone'
            }
        },
        required: ['x1', 'y1', 'z1', 'x2', 'y2', 'z2']
    };

    /**
     * 直線構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.x1 - 開始点のX座標（東西方向の位置）
     * @param args.y1 - 開始点のY座標（高さ、通常64が地上レベル）
     * @param args.z1 - 開始点のZ座標（南北方向の位置）
     * @param args.x2 - 終了点のX座標（東西方向の位置）
     * @param args.y2 - 終了点のY座標（高さ、斜面の場合は異なる高さ可）
     * @param args.z2 - 終了点のZ座標（南北方向の位置）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @returns 建築実行結果
     * 
     * @throws Y座標が範囲外の場合（-64から320の範囲外）
     * @throws 線の長さが制限を超える場合（100ブロック超過）
     * @throws ブロック数が制限を超える場合（100ブロック超過）
     * 
     * @example
     * ```typescript
     * // 縦方向の橋を建築
     * const result = await tool.execute({
     *   x1: 50, y1: 65, z1: 0,
     *   x2: 50, y2: 75, z2: 20,
     *   material: "cobblestone"
     * });
     * 
     * if (result.success) {
     *   console.log(`直線建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        x1: number;
        y1: number;
        z1: number;
        x2: number;
        y2: number;
        z2: number;
        material?: string;
    }): Promise<ToolCallResult> {
        try {
            const { x1, y1, z1, x2, y2, z2, material = 'minecraft:stone' } = args;
            
            // 座標の整数化
            const start = {
                x: Math.floor(x1),
                y: Math.floor(y1),
                z: Math.floor(z1)
            };
            const end = {
                x: Math.floor(x2),
                y: Math.floor(y2),
                z: Math.floor(z2)
            };
            
            // Y座標の検証
            if (start.y < -64 || start.y > 320 || end.y < -64 || end.y > 320) {
                return {
                    success: false,
                    message: 'Y coordinates must be between -64 and 320'
                };
            }
            
            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }
            
            // 直線の長さを計算
            const distance = Math.sqrt(
                Math.pow(end.x - start.x, 2) + 
                Math.pow(end.y - start.y, 2) + 
                Math.pow(end.z - start.z, 2)
            );
            
            if (distance > 100) {
                return {
                    success: false,
                    message: 'Line too long (maximum 100 blocks)'
                };
            }
            
            // 直線上の点を計算
            const steps = Math.ceil(distance);
            // Socket-BE APIを使用してブロック配置
            if (!this.world) {
                return { success: false, message: 'World not available. Ensure Minecraft is connected.' };
            }

            try {
                const placedBlocks: Set<string> = new Set();
                let blocksPlaced = 0;
                
                for (let i = 0; i <= steps; i++) {
                    const t = steps === 0 ? 0 : i / steps;
                    const x = Math.floor(start.x + (end.x - start.x) * t);
                    const y = Math.floor(start.y + (end.y - start.y) * t);
                    const z = Math.floor(start.z + (end.z - start.z) * t);
                    
                    // 重複する座標をチェック
                    const coordKey = `${x},${y},${z}`;
                    if (!placedBlocks.has(coordKey)) {
                        placedBlocks.add(coordKey);
                        await this.world.setBlock({x, y, z}, blockId);
                        blocksPlaced++;
                    }
                }
                
                if (blocksPlaced > 100) {
                    return {
                        success: false,
                        message: 'Too many blocks to place (maximum 100)'
                    };
                }

                return {
                    success: true,
                    message: `Line built with ${blockId} from (${start.x},${start.y},${start.z}) to (${end.x},${end.y},${end.z}). Placed ${blocksPlaced} blocks.`,
                    data: {
                        type: 'line',
                        from: start,
                        to: end,
                        material: blockId,
                        length: distance,
                        blocksPlaced: blocksPlaced,
                        apiUsed: 'Socket-BE'
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Building error: ${error instanceof Error ? error.message : String(error)}`
                };
            }

        } catch (error) {
            return {
                success: false,
                message: `Error building line: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}