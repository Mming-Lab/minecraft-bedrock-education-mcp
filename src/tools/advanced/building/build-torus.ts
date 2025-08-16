import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { executeBuildWithOptimization } from '../../../utils/integration/build-executor';
import { calculateTorusPositions } from '../../../utils/geometry';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';

/**
 * トーラス（ドーナツ型）構造物を建築するツール
 * 
 * @description
 * 指定された中心点、主半径（メジャー半径）、副半径（マイナー半径）からトーラスを建築します。
 * ドーナツ型、リング型、円形噪水、アリーナ座席などの円筒形構造物に最適で、
 * 数学的なトーラス方程式を使用して正確な形状を実現します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildTorusTool();
 * 
 * // 大型の石のリングを建築
 * await tool.execute({
 *   centerX: 0, centerY: 70, centerZ: 0,
 *   majorRadius: 15, minorRadius: 4,
 *   material: "stone",
 *   hollow: false
 * });
 * 
 * // 中空のガラスの装飾リングを建築
 * await tool.execute({
 *   centerX: 50, centerY: 80, centerZ: 50,
 *   majorRadius: 8, minorRadius: 2,
 *   material: "glass",
 *   hollow: true
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildTorusTool extends BaseTool {
    readonly name = 'build_torus';
    readonly description = 'Build TORUS: donut, ring, circular fountain, arena seating, portal. Requires: centerX,centerY,centerZ,majorRadius,minorRadius. Optional: axis';
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
            majorRadius: {
                type: 'number',
                description: 'Outer ring size (how big the overall donut is). Small ring=8, Medium ring=15, Large ring=30. This determines the donut hole size',
                minimum: 3,
                maximum: 50
            },
            minorRadius: {
                type: 'number',
                description: 'Tube thickness (how thick the donut ring is). Thin tube=2, Medium tube=4, Thick tube=8. Must be smaller than majorRadius',
                minimum: 1,
                maximum: 20
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone for foundations, glass for decorative rings, water for fountains)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for ring shell only, or solid (false) for full torus structure',
                default: false
            },
            axis: {
                type: 'string',
                description: 'Torus axis (normal to the plane): x (YZ-plane torus), y (XZ-plane torus), z (XY-plane torus)',
                enum: ['x', 'y', 'z'],
                default: 'y'
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'majorRadius', 'minorRadius']
    };

    /**
     * トーラス（ドーナツ型）構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 中心X座標（東西方向の中心位置）
     * @param args.centerY - 中心Y座標（高さの中心位置）
     * @param args.centerZ - 中心Z座標（南北方向の中心位置）
     * @param args.majorRadius - 主半径（リングの大きさ、3-50の範囲）
     * @param args.minorRadius - 副半径（管の太さ、1-20の範囲、majorRadiusより小さい必要）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.hollow - 中空にするかどうか（デフォルト: false）
     * @returns 建築実行結果
     * 
     * @throws 主半径が範囲外の場合（3-50の範囲外）
     * @throws 副半径が範囲外の場合（1-20の範囲外）
     * @throws 副半径が主半径以上の場合
     * @throws トーラスが有効座標範囲を超える場合
     * @throws ブロック数が制限を超える場合（5000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 中空のアリーナ座席を建築
     * const result = await tool.execute({
     *   centerX: 0, centerY: 65, centerZ: 0,
     *   majorRadius: 20, minorRadius: 3,
     *   material: "stone_brick_stairs",
     *   hollow: true
     * });
     * 
     * if (result.success) {
     *   console.log(`トーラス建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        action?: string;
        centerX: number;
        centerY: number;
        centerZ: number;
        majorRadius: number;
        minorRadius: number;
        material?: string;
        hollow?: boolean;
        axis?: 'x' | 'y' | 'z';
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
                return this.createErrorResponse('Missing required arguments: centerX, centerY, centerZ, majorRadius, minorRadius');
            }

            const { 
                action = 'build',
                centerX, 
                centerY, 
                centerZ, 
                majorRadius, 
                minorRadius, 
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
            
            const majorRadiusInt = Math.round(majorRadius);
            const minorRadiusInt = Math.round(minorRadius);
            
            // パラメータ検証
            if (majorRadiusInt < 3 || majorRadiusInt > 50) {
                return this.createErrorResponse('Major radius must be between 3 and 50');
            }
            
            if (minorRadiusInt < 1 || minorRadiusInt > 20) {
                return this.createErrorResponse('Minor radius must be between 1 and 20');
            }
            
            if (minorRadiusInt >= majorRadiusInt) {
                return this.createErrorResponse('Minor radius must be smaller than major radius');
            }
            
            // 座標範囲の検証
            const totalRadius = majorRadiusInt + minorRadiusInt;
            const minX = center.x - totalRadius;
            const maxX = center.x + totalRadius;
            const minY = center.y - minorRadiusInt;
            const maxY = center.y + minorRadiusInt;
            const minZ = center.z - totalRadius;
            const maxZ = center.z + totalRadius;
            
            if (!this.validateCoordinates(minX, minY, minZ) || 
                !this.validateCoordinates(maxX, maxY, maxZ)) {
                return this.createErrorResponse('Torus extends beyond valid coordinates');
            }
            
            // ブロックIDの正規化
            const blockId = this.normalizeBlockId(material);
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            // 座標変換ヘルパー関数
            const transformCoordinates = (localX: number, localY: number, localZ: number): {x: number, y: number, z: number} => {
                switch (axis) {
                    case 'x':
                        // X軸トーラス: YZ平面でドーナツ、X軸が法線
                        return {
                            x: center.x + localY,  // Y(tube height) → X (axis direction)
                            y: center.y + localX,  // X(major radius) → Y
                            z: center.z + localZ   // Z(major radius) → Z
                        };
                    case 'z':
                        // Z軸トーラス: XY平面でドーナツ、Z軸が法線
                        return {
                            x: center.x + localX,  // X(major radius) → X
                            y: center.y + localZ,  // Z(major radius) → Y
                            z: center.z + localY   // Y(tube height) → Z (axis direction)
                        };
                    case 'y':
                    default:
                        // Y軸トーラス（デフォルト）: XZ平面でドーナツ、Y軸が法線
                        return {
                            x: center.x + localX,  // X(major radius) → X
                            y: center.y + localY,  // Y(tube height) → Y (axis direction)
                            z: center.z + localZ   // Z(major radius) → Z
                        };
                }
            };
            
            
            // トーラスの座標を計算
            const positions = calculateTorusPositions(center, majorRadiusInt, minorRadiusInt, hollow);
            
            // ブロック数制限チェック
            if (positions.length > BUILD_LIMITS.TORUS) {
                return this.createErrorResponse(`Too many blocks to place (maximum ${BUILD_LIMITS.TORUS.toLocaleString()})`);
            }
            
            try {
                // 最適化されたビルド実行
                const result = await executeBuildWithOptimization(
                    this.world,
                    positions,
                    blockId,
                    {
                        type: 'torus',
                        center: center,
                        majorRadius: majorRadiusInt,
                        minorRadius: minorRadiusInt,
                        material: blockId,
                        hollow: hollow,
                        axis: axis,
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
                `Error building torus: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}