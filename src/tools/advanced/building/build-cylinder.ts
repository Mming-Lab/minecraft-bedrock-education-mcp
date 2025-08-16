import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { executeBuildWithOptimization } from '../../../utils/integration/build-executor';
import { calculateCylinderPositions } from '../../../utils/geometry';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';

/**
 * 円柱構造物を建築するツール
 * 
 * @description
 * 指定された中心点、半径、高さから円柱構造物を建築します。
 * タワー、柱、煙突、パイプなどの円筒形構造物に最適で、
 * X、Y、Z軸のいずれの方向へも伸ばすことが可能です。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildCylinderTool();
 * 
 * // 縦方向の石のタワーを建築
 * await tool.execute({
 *   centerX: 0, centerY: 64, centerZ: 0,
 *   radius: 5, height: 20,
 *   material: "stone",
 *   hollow: false, axis: "y"
 * });
 * 
 * // 水平方向の中空パイプを建築
 * await tool.execute({
 *   centerX: 20, centerY: 70, centerZ: 20,
 *   radius: 3, height: 15,
 *   material: "iron_block",
 *   hollow: true, axis: "x"
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildCylinderTool extends BaseTool {
    readonly name = 'build_cylinder';
    readonly description = 'Build CYLINDER: tower, pillar, column, chimney, pipe, tube. Requires: centerX,centerY,centerZ,radius,height. Optional: axis';
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
                description: 'Center X coordinate (east-west position where the cylinder will be centered)'
            },
            centerY: {
                type: 'number', 
                description: 'Bottom Y coordinate (ground level height where cylinder starts, typically 64)'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate (north-south position where the cylinder will be centered)'
            },
            radius: {
                type: 'number',
                description: 'Radius in blocks (how wide the cylinder is). Thin: 2-4, Medium: 5-10, Wide: 15-30',
                minimum: 1,
                maximum: 30
            },
            height: {
                type: 'number',
                description: 'Height in blocks (how tall the cylinder is). Short: 5-10, Medium: 15-25, Tall: 30-50',
                minimum: 1,
                maximum: 50
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone, brick, concrete, wood, etc.)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for cylinder shell/walls only, or solid (false) for full cylinder',
                default: false
            },
            axis: {
                type: 'string',
                description: 'Direction the cylinder extends: y=vertical (normal tower), x=horizontal east-west, z=horizontal north-south',
                enum: ['y', 'x', 'z'],
                default: 'y'
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius', 'height']
    };

    /**
     * 円柱構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 中心X座標（東西方向の中心位置）
     * @param args.centerY - 中心Y座標（高さ、通常64が地上レベル）
     * @param args.centerZ - 中心Z座標（南北方向の中心位置）
     * @param args.radius - 円柱の半径（ブロック単位、1-30の範囲）
     * @param args.height - 円柱の高さ（ブロック単位、1-50の範囲）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.hollow - 中空にするかどうか（デフォルト: false）
     * @param args.axis - 円柱の伸びる方向（"y": 縦、"x": 東西、"z": 南北、デフォルト: "y"）
     * @returns 建築実行結果
     * 
     * @throws 半径が範囲外の場合（1-30の範囲外）
     * @throws 高さが範囲外の場合（1-50の範囲外）
     * @throws axisが無効な値の場合
     * @throws 円柱が有効座標範囲を超える場合
     * @throws ブロック数が制限を超える場合（5000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 中空の高いタワーを建築
     * const result = await tool.execute({
     *   centerX: 100, centerY: 64, centerZ: 100,
     *   radius: 8, height: 30,
     *   material: "cobblestone",
     *   hollow: true, axis: "y"
     * });
     * 
     * if (result.success) {
     *   console.log(`円柱建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        action?: string;
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        height: number;
        material?: string;
        hollow?: boolean;
        axis?: string;
    }): Promise<ToolCallResult> {
        try {
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: "World not available. Ensure Minecraft is connected." };
            }

            // 引数の基本検証
            if (!args || typeof args !== 'object') {
                return this.createErrorResponse('Invalid arguments provided');
            }

            if (!this.validateArgs(args)) {
                return this.createErrorResponse('Missing required arguments: centerX, centerY, centerZ, radius, height');
            }

            const { 
                action = 'build',
                centerX, 
                centerY, 
                centerZ, 
                radius, 
                height, 
                material = 'minecraft:stone', 
                hollow = false,
                axis = 'y'
            } = args;
            
            // actionパラメータをサポート（現在は build のみ）
            if (action !== 'build') {
                return this.createErrorResponse(`Unknown action: ${action}. Only 'build' is supported.`);
            }
            
            // 座標の整数化
            const center = {
                x: this.normalizeCoordinate(centerX),
                y: this.normalizeCoordinate(centerY),
                z: this.normalizeCoordinate(centerZ)
            };
            
            const radiusInt = Math.round(radius);
            const heightInt = Math.round(height);
            
            // パラメータ検証
            if (radiusInt < 1 || radiusInt > 30) {
                return this.createErrorResponse('Radius must be between 1 and 30');
            }
            
            if (heightInt < 1 || heightInt > 50) {
                return this.createErrorResponse('Height must be between 1 and 50');
            }
            
            if (!['x', 'y', 'z'].includes(axis)) {
                return this.createErrorResponse('Axis must be x, y, or z');
            }
            
            // 座標検証（軸に応じて範囲をチェック）
            let minX = center.x, maxX = center.x;
            let minY = center.y, maxY = center.y;
            let minZ = center.z, maxZ = center.z;
            
            if (axis === 'y') {
                minX = center.x - radiusInt; maxX = center.x + radiusInt;
                minY = center.y; maxY = center.y + heightInt - 1;
                minZ = center.z - radiusInt; maxZ = center.z + radiusInt;
            } else if (axis === 'x') {
                minX = center.x; maxX = center.x + heightInt - 1;
                minY = center.y - radiusInt; maxY = center.y + radiusInt;
                minZ = center.z - radiusInt; maxZ = center.z + radiusInt;
            } else if (axis === 'z') {
                minX = center.x - radiusInt; maxX = center.x + radiusInt;
                minY = center.y - radiusInt; maxY = center.y + radiusInt;
                minZ = center.z; maxZ = center.z + heightInt - 1;
            }
            
            if (!this.validateCoordinates(minX, minY, minZ) || 
                !this.validateCoordinates(maxX, maxY, maxZ)) {
                return this.createErrorResponse('Cylinder extends beyond valid coordinates');
            }
            
            // ブロックIDの正規化
            const blockId = this.normalizeBlockId(material);
            
            // 円柱の座標を計算
            const positions = calculateCylinderPositions(center, radiusInt, heightInt, axis as 'x' | 'y' | 'z', hollow);
            
            // ブロック数制限チェック（最適化効果を考慮）
            if (positions.length > BUILD_LIMITS.CYLINDER) {
                return this.createErrorResponse(`Too many blocks to place (maximum ${BUILD_LIMITS.CYLINDER.toLocaleString()})`);
            }
            
            try {
                // 最適化されたビルド実行
                const result = await executeBuildWithOptimization(
                    this.world,
                    positions,
                    blockId,
                    {
                        type: 'cylinder',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
                        axis: axis,
                        hollow: hollow,
                        material: blockId,
                        apiUsed: 'Socket-BE'
                    }
                );
                
                if (!result.success) {
                    return this.createErrorResponse(result.message);
                }
                
                return {
                    success: true,
                    message: result.message,
                    data: result.data
                };
            } catch (buildError) {
                return this.createErrorResponse(`Building error: ${buildError instanceof Error ? buildError.message : String(buildError)}`);
            }

        } catch (error) {
            return this.createErrorResponse(
                `Error building cylinder: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}