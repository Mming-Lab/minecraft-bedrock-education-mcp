import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { executeBuildWithOptimization } from '../../../utils/integration/build-executor';
import { calculateSpherePositions } from '../../../utils/geometry';
import { DirectionalParams } from '../../../utils/integration/rotation-transformer';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';

/**
 * 球体構造物を建築するツール
 * 
 * @description
 * 指定された中心点と半径から球体または中空球体を建築します。
 * 三次元の球体方程式を使用して正確な形状を生成し、
 * 半径制限（最大20ブロック）により安全性とパフォーマンスを確保します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildSphereTool();
 * 
 * // 実体の石の球体を建築
 * await tool.execute({
 *   centerX: 100, centerY: 70, centerZ: 200,
 *   radius: 10,
 *   material: "stone",
 *   hollow: false
 * });
 * 
 * // 中空のガラスの球体（ドーム）を建築
 * await tool.execute({
 *   centerX: 150, centerY: 80, centerZ: 250,
 *   radius: 8,
 *   material: "glass",
 *   hollow: true
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildSphereTool extends BaseTool {
    readonly name = 'build_sphere';
    readonly description = 'Build SPHERE: ball, dome, round structure, planet, orb. Specify center (centerX,centerY,centerZ) + radius. Coordinates can be positive or negative (e.g. centerX:-25, centerZ:-75). Perfect for domes, decorations, planets, bubbles.';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Build action to perform',
                enum: ['build'],
                default: 'build'
            },
            centerX: {
                type: 'number',
                description: 'Center X coordinate (east-west position of sphere center)'
            },
            centerY: {
                type: 'number',
                description: 'Center Y coordinate (height/vertical position of sphere center, typically 64-100)'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate (north-south position of sphere center)'
            },
            radius: {
                type: 'number',
                description: 'Radius of the sphere in blocks (how big the sphere is). Small: 3-5, Medium: 8-12, Large: 15-20',
                minimum: 1,
                maximum: 20
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone, glass, wool, concrete, etc.)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for sphere shell/dome, or solid (false) for full sphere',
                default: false
            },
            direction: {
                type: 'string',
                description: 'Orientation direction: +x, +y, +z, -x, -y, -z, or custom for advanced rotation',
                enum: ['+x', '+y', '+z', '-x', '-y', '-z', 'custom'],
                default: '+y'
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius']
    };

    /**
     * 球体構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 球体の中心X座標（東西方向の位置）
     * @param args.centerY - 球体の中心Y座標（高さ、通常64-100）
     * @param args.centerZ - 球体の中心Z座標（南北方向の位置）
     * @param args.radius - 球体の半径（ブロック単位、1-20の範囲）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.hollow - 中空にするかどうか（デフォルト: false）
     * @returns 建築実行結果
     * 
     * @throws Y座標が範囲外の場合
     * @throws 半径が制限を超える場合（1-20の範囲外）
     * @throws ブロック数が制限を超える場合（1000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 小さなドーム型シェルターを建築
     * const result = await tool.execute({
     *   centerX: 0, centerY: 70, centerZ: 0,
     *   radius: 5,
     *   material: "cobblestone",
     *   hollow: true
     * });
     * 
     * if (result.success) {
     *   console.log(`球体建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        action?: string;
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        material?: string;
        hollow?: boolean;
        direction?: string;
    }): Promise<ToolCallResult> {
        try {
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: "World not available. Ensure Minecraft is connected." };
            }

            const { action = 'build', centerX, centerY, centerZ, radius, material = 'minecraft:stone', hollow = false, direction = '+y' } = args;

            // actionパラメータをサポート（現在は build のみ）
            if (action !== 'build') {
                return this.createErrorResponse(`Unknown action: ${action}. Only 'build' is supported.`);
            }

            // 座標の整数化
            const center = {
                x: Math.floor(centerX),
                y: Math.floor(centerY),
                z: Math.floor(centerZ)
            };

            // Y座標の検証
            if (center.y - radius < -64 || center.y + radius > 320) {
                return {
                    success: false,
                    message: 'Sphere extends beyond valid Y coordinates (-64 to 320)'
                };
            }

            // 半径の検証
            if (radius < 1 || radius > 20) {
                return {
                    success: false,
                    message: 'Radius must be between 1 and 20'
                };
            }

            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }

            try {
                // 球体の座標を計算
                const positions = calculateSpherePositions(center, radius, hollow);

                // 大きな球体の場合は制限（最適化効果を考慮）
                if (positions.length > BUILD_LIMITS.SPHERE) {
                    return {
                        success: false,
                        message: `Too many blocks to place (maximum ${BUILD_LIMITS.SPHERE.toLocaleString()})`
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
                        type: 'sphere',
                        center: center,
                        radius: radius,
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
                message: `Error building sphere: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}