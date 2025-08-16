import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { executeBuildWithOptimization } from '../../../utils/integration/build-executor';
import { calculateHelixPositions } from '../../../utils/geometry';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';

/**
 * ヘリックス（螺旋）構造物を建築するツール
 * 
 * @description
 * 指定された中心点、半径、高さ、回転数から螺旋状の構造物を建築します。
 * 螺旋階段、DNAモデル、コルクスクリュータワーなどの螺旋形構造物に最適で、
 * Bresenhamアルゴリズムを応用した3D螺旋描画で連続した構造を実現します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildHelixTool();
 * 
 * // 時計回りの螺旋階段を建築
 * await tool.execute({
 *   centerX: 0, centerY: 64, centerZ: 0,
 *   radius: 5, height: 20, turns: 3,
 *   material: "oak_stairs",
 *   clockwise: true
 * });
 * 
 * // 反時計回りのDNAモデルを建築
 * await tool.execute({
 *   centerX: 50, centerY: 70, centerZ: 50,
 *   radius: 3, height: 15, turns: 2.5,
 *   material: "glowstone",
 *   clockwise: false
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildHelixTool extends BaseTool {
    readonly name = 'build_helix';
    readonly description = 'Build HELIX/SPIRAL: spiral staircase, corkscrew, DNA model, twisted tower. Requires: centerX,centerY,centerZ,radius,height,turns. Optional: axis,direction,chirality';
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
                description: 'Bottom Y coordinate'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate'
            },
            radius: {
                type: 'number',
                description: 'How wide the spiral is (distance from center). Small spiral=3, Medium=8, Large=15. Larger radius = wider staircases',
                minimum: 1,
                maximum: 50
            },
            height: {
                type: 'number',
                description: 'How tall the spiral is (total vertical height). Short=10, Medium=25, Tall=50. Each turn uses height/turns blocks vertically',
                minimum: 2,
                maximum: 100
            },
            turns: {
                type: 'number',
                description: 'How many complete rotations. Few turns=gentle slope (1-2), Many turns=steep spiral (5-10). 0.5=half turn, 1.5=one and half turns',
                minimum: 0.5,
                maximum: 20
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stairs for actual staircases, stone for pillars, glowstone for decorative spirals)',
                default: 'minecraft:stone'
            },
            clockwise: {
                type: 'boolean',
                description: 'Rotation direction: true=clockwise (right-hand spiral), false=counter-clockwise (left-hand spiral)',
                default: true
            },
            axis: {
                type: 'string',
                description: 'Helix axis direction: x (east-west), y (up-down), z (north-south)',
                enum: ['x', 'y', 'z'],
                default: 'y'
            },
            direction: {
                type: 'string',
                description: 'Growth direction along axis: positive or negative',
                enum: ['positive', 'negative'],
                default: 'positive'
            },
            chirality: {
                type: 'string',
                description: 'Helix handedness: right (clockwise from growth direction), left (counter-clockwise)',
                enum: ['right', 'left'],
                default: 'right'
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius', 'height', 'turns']
    };

    /**
     * ヘリックス（螺旋）構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 中心X座標（東西方向の中心位置）
     * @param args.centerY - 中心Y座標（開始高座、螺旋の最下部）
     * @param args.centerZ - 中心Z座標（南北方向の中心位置）
     * @param args.radius - 螺旋の半径（中心からの距離、1-50の範囲）
     * @param args.height - 螺旋の高さ（全体の高さ、2-100の範囲）
     * @param args.turns - 完全回転数（0.5-20の範囲、0.5は半回転）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.clockwise - 回転方向（true: 時計回り、false: 反時計回り、デフォルト: true）
     * @returns 建築実行結果
     * 
     * @throws 半径が範囲外の場合（1-50の範囲外）
     * @throws 高さが範囲外の場合（2-100の範囲外）
     * @throws 回転数が範囲外の場合（0.5-20の範囲外）
     * @throws ヘリックスが有効座標範囲を超える場合
     * @throws ブロック数が制限を超える場合（5000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 緊密な螺旋タワーを建築
     * const result = await tool.execute({
     *   centerX: 100, centerY: 64, centerZ: 100,
     *   radius: 4, height: 25, turns: 5,
     *   material: "cobblestone",
     *   clockwise: true
     * });
     * 
     * if (result.success) {
     *   console.log(`ヘリックス建築完了: ${result.data.blocksPlaced}ブロック配置`);
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
        turns: number;
        material?: string;
        clockwise?: boolean;
        axis?: 'x' | 'y' | 'z';
        direction?: 'positive' | 'negative';
        chirality?: 'right' | 'left';
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
                return this.createErrorResponse('Missing required arguments: centerX, centerY, centerZ, radius, height, turns');
            }

            const { 
                action = 'build',
                centerX, 
                centerY, 
                centerZ, 
                radius, 
                height, 
                turns, 
                material = 'minecraft:stone', 
                clockwise = true,
                axis = 'y',
                direction = 'positive',
                chirality = 'right'
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
            if (radiusInt < 1 || radiusInt > 50) {
                return this.createErrorResponse('Radius must be between 1 and 50');
            }
            
            if (heightInt < 2 || heightInt > 100) {
                return this.createErrorResponse('Height must be between 2 and 100');
            }
            
            if (turns < 0.5 || turns > 20) {
                return this.createErrorResponse('Turns must be between 0.5 and 20');
            }
            
            // 座標範囲の検証（軸別対応）
            let minX, maxX, minY, maxY, minZ, maxZ;
            
            switch (axis) {
                case 'x':
                    minX = center.x;
                    maxX = center.x + heightInt - 1;
                    minY = center.y - radiusInt;
                    maxY = center.y + radiusInt;
                    minZ = center.z - radiusInt;
                    maxZ = center.z + radiusInt;
                    break;
                case 'z':
                    minX = center.x - radiusInt;
                    maxX = center.x + radiusInt;
                    minY = center.y - radiusInt;
                    maxY = center.y + radiusInt;
                    minZ = center.z;
                    maxZ = center.z + heightInt - 1;
                    break;
                case 'y':
                default:
                    minX = center.x - radiusInt;
                    maxX = center.x + radiusInt;
                    minY = center.y;
                    maxY = center.y + heightInt - 1;
                    minZ = center.z - radiusInt;
                    maxZ = center.z + radiusInt;
                    break;
            }
            
            if (!this.validateCoordinates(minX, minY, minZ) || 
                !this.validateCoordinates(maxX, maxY, maxZ)) {
                return this.createErrorResponse('Helix extends beyond valid coordinates');
            }
            
            // ブロックIDの正規化
            const blockId = this.normalizeBlockId(material);
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            // 座標変換ヘルパー関数
            const transformCoordinates = (localX: number, localY: number, localZ: number): {x: number, y: number, z: number} => {
                const directionMultiplier = direction === 'positive' ? 1 : -1;
                const chiralityMultiplier = chirality === 'right' ? 1 : -1;
                
                switch (axis) {
                    case 'x':
                        // X軸らせん: YZ平面で回転、X方向に進行
                        return {
                            x: center.x + localY * directionMultiplier,
                            y: center.y + localX * chiralityMultiplier,
                            z: center.z + localZ * chiralityMultiplier
                        };
                    case 'z':
                        // Z軸らせん: XY平面で回転、Z方向に進行
                        return {
                            x: center.x + localX * chiralityMultiplier,
                            y: center.y + localZ * chiralityMultiplier,
                            z: center.z + localY * directionMultiplier
                        };
                    case 'y':
                    default:
                        // Y軸らせん（デフォルト）: XZ平面で回転、Y方向に進行
                        return {
                            x: center.x + localX * chiralityMultiplier,
                            y: center.y + localY * directionMultiplier,
                            z: center.z + localZ * chiralityMultiplier
                        };
                }
            };
            
            // 3D Bresenham風螺旋アルゴリズム（候補点3つの決定版）
            const totalAngle = turns * 2 * Math.PI; // 総回転角度（ラジアン）
            const rotationDirection = clockwise ? 1 : -1; // 回転方向
            
            const placedPositions = new Set<string>();
            
            // 螺旋の現在位置（ループ内で更新）
            
            // 螺旋の座標を計算
            const positions = calculateHelixPositions(
                center, 
                heightInt, 
                radiusInt, 
                turns, 
                axis as 'x' | 'y' | 'z'
            );
            
            // ブロック数制限チェック
            if (positions.length > BUILD_LIMITS.HELIX) {
                return this.createErrorResponse(`Too many blocks to place (maximum ${BUILD_LIMITS.HELIX.toLocaleString()})`);
            }
            
            try {
                // 最適化されたビルド実行
                const result = await executeBuildWithOptimization(
                    this.world,
                    positions,
                    blockId,
                    {
                        type: 'helix',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
                        turns: turns,
                        material: blockId,
                        clockwise: clockwise,
                        axis: axis,
                        direction: direction,
                        chirality: chirality,
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
                `Error building helix: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}