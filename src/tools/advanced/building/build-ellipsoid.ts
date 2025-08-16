import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { executeBuildWithOptimization } from '../../../utils/integration/build-executor';
import { calculateEllipsoidPositions } from '../../../utils/geometry';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';

/**
 * 楕円体構造物を建築するツール
 * 
 * @description
 * 指定された中心点とX、Y、Z軸の各半径から楕円体を建築します。
 * 球体と異なり、各軸方向に異なる半径を持つことで、
 * 卵型、平たいドーム、引き伸ばされた球などの独特な形状を作成できます。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildEllipsoidTool();
 * 
 * // 平たいドームを建築
 * await tool.execute({
 *   centerX: 0, centerY: 70, centerZ: 0,
 *   radiusX: 10, radiusY: 5, radiusZ: 10,
 *   material: "glass",
 *   hollow: true
 * });
 * 
 * // 卵型の実体構造物を建築
 * await tool.execute({
 *   centerX: 50, centerY: 80, centerZ: 50,
 *   radiusX: 6, radiusY: 12, radiusZ: 8,
 *   material: "concrete",
 *   hollow: false
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildEllipsoidTool extends BaseTool {
    readonly name = 'build_ellipsoid';
    readonly description = 'Build an ellipsoid (stretched/oval sphere) structure. Perfect for egg shapes, stretched domes, oval rooms, or artistic sculptures. Different radii create unique shapes. Example: radiusX=10, radiusY=5, radiusZ=10 creates a flattened dome';
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
                description: 'Center X coordinate'
            },
            centerY: {
                type: 'number',
                description: 'Center Y coordinate'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate'
            },
            radiusX: {
                type: 'number',
                description: 'Width radius (east-west stretch). Large=wide shape, Small=narrow shape. Example: 10=wide, 5=narrow',
                minimum: 1,
                maximum: 50
            },
            radiusY: {
                type: 'number',
                description: 'Height radius (vertical stretch). Large=tall shape, Small=flat shape. Example: 15=tall dome, 3=flat pancake',
                minimum: 1,
                maximum: 50
            },
            radiusZ: {
                type: 'number',
                description: 'Depth radius (north-south stretch). Large=deep shape, Small=shallow shape. Example: 8=deep, 4=shallow',
                minimum: 1,
                maximum: 50
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone, glass, concrete, wool for colorful sculptures)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for shell/room inside, or solid (false) for full ellipsoid sculpture',
                default: false
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radiusX', 'radiusY', 'radiusZ']
    };

    /**
     * 楕円体構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 中心X座標（東西方向の中心位置）
     * @param args.centerY - 中心Y座標（高さの中心位置）
     * @param args.centerZ - 中心Z座標（南北方向の中心位置）
     * @param args.radiusX - X軸方向の半径（幅の半分、1-50の範囲）
     * @param args.radiusY - Y軸方向の半径（高さの半分、1-50の範囲）
     * @param args.radiusZ - Z軸方向の半径（奥行きの半分、1-50の範囲）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.hollow - 中空にするかどうか（デフォルト: false）
     * @returns 建築実行結果
     * 
     * @throws X軸半径が範囲外の場合（1-50の範囲外）
     * @throws Y軸半径が範囲外の場合（1-50の範囲外）
     * @throws Z軸半径が範囲外の場合（1-50の範囲外）
     * @throws 楕円体が有効座標範囲を超える場合
     * @throws ブロック数が制限を超える場合（5000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 幅広で低いプラットフォームを建築
     * const result = await tool.execute({
     *   centerX: 0, centerY: 65, centerZ: 0,
     *   radiusX: 15, radiusY: 3, radiusZ: 12,
     *   material: "stone_bricks",
     *   hollow: false
     * });
     * 
     * if (result.success) {
     *   console.log(`楕円体建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        action?: string;
        centerX: number;
        centerY: number;
        centerZ: number;
        radiusX: number;
        radiusY: number;
        radiusZ: number;
        material?: string;
        hollow?: boolean;
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
                return this.createErrorResponse('Missing required arguments: centerX, centerY, centerZ, radiusX, radiusY, radiusZ');
            }

            const { 
                action = 'build',
                centerX, 
                centerY, 
                centerZ, 
                radiusX, 
                radiusY, 
                radiusZ, 
                material = 'minecraft:stone', 
                hollow = false 
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
            
            const radiusXInt = Math.round(radiusX);
            const radiusYInt = Math.round(radiusY);
            const radiusZInt = Math.round(radiusZ);
            
            // パラメータ検証
            if (radiusXInt < 1 || radiusXInt > 50) {
                return this.createErrorResponse('X radius must be between 1 and 50');
            }
            
            if (radiusYInt < 1 || radiusYInt > 50) {
                return this.createErrorResponse('Y radius must be between 1 and 50');
            }
            
            if (radiusZInt < 1 || radiusZInt > 50) {
                return this.createErrorResponse('Z radius must be between 1 and 50');
            }
            
            // 座標範囲の検証
            const minX = center.x - radiusXInt;
            const maxX = center.x + radiusXInt;
            const minY = center.y - radiusYInt;
            const maxY = center.y + radiusYInt;
            const minZ = center.z - radiusZInt;
            const maxZ = center.z + radiusZInt;
            
            if (!this.validateCoordinates(minX, minY, minZ) || 
                !this.validateCoordinates(maxX, maxY, maxZ)) {
                return this.createErrorResponse('Ellipsoid extends beyond valid coordinates');
            }
            
            // ブロックIDの正規化
            const blockId = this.normalizeBlockId(material);
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            // 楕円体形状の計算
            const radiusXSquared = radiusXInt * radiusXInt;
            const radiusYSquared = radiusYInt * radiusYInt;
            const radiusZSquared = radiusZInt * radiusZInt;
            
            
            // 楕円体の座標を計算
            const positions = calculateEllipsoidPositions(center, radiusXInt, radiusYInt, radiusZInt, hollow);
            
            // ブロック数制限チェック
            if (positions.length > BUILD_LIMITS.ELLIPSOID) {
                return this.createErrorResponse(`Too many blocks to place (maximum ${BUILD_LIMITS.ELLIPSOID.toLocaleString()})`);
            }
            
            try {
                // 最適化されたビルド実行
                const result = await executeBuildWithOptimization(
                    this.world,
                    positions,
                    blockId,
                    {
                        type: 'ellipsoid',
                        center: center,
                        radiusX: radiusXInt,
                        radiusY: radiusYInt,
                        radiusZ: radiusZInt,
                        material: blockId,
                        hollow: hollow,
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
                `Error building ellipsoid: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}