import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

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
            
            const innerRadiusX = hollow ? Math.max(1, radiusXInt - 1) : 1;
            const innerRadiusY = hollow ? Math.max(1, radiusYInt - 1) : 1;
            const innerRadiusZ = hollow ? Math.max(1, radiusZInt - 1) : 1;
            const innerRadiusXSquared = innerRadiusX * innerRadiusX;
            const innerRadiusYSquared = innerRadiusY * innerRadiusY;
            const innerRadiusZSquared = innerRadiusZ * innerRadiusZ;
            
            for (let x = -radiusXInt; x <= radiusXInt; x++) {
                const xTerm = (x * x * radiusYSquared * radiusZSquared);
                
                for (let y = -radiusYInt; y <= radiusYInt; y++) {
                    const yTerm = (y * y * radiusXSquared * radiusZSquared);
                    const xyTerm = xTerm + yTerm;
                    
                    for (let z = -radiusZInt; z <= radiusZInt; z++) {
                        const zTerm = (z * z * radiusXSquared * radiusYSquared);
                        
                        // 楕円体の方程式: (x/a)² + (y/b)² + (z/c)² ≤ 1
                        // 整数演算に変換: x²b²c² + y²a²c² + z²a²b² ≤ a²b²c²
                        const distance = xyTerm + zTerm;
                        const threshold = radiusXSquared * radiusYSquared * radiusZSquared;
                        
                        if (distance <= threshold) {
                            let isInside = true;
                            
                            if (hollow) {
                                const innerDistance = (x * x * innerRadiusYSquared * innerRadiusZSquared) +
                                    (y * y * innerRadiusXSquared * innerRadiusZSquared) +
                                    (z * z * innerRadiusXSquared * innerRadiusYSquared);
                                const innerThreshold = innerRadiusXSquared * innerRadiusYSquared * innerRadiusZSquared;
                                isInside = innerDistance >= innerThreshold;
                            }
                            
                            if (isInside) {
                                const worldX = center.x + x;
                                const worldY = center.y + y;
                                const worldZ = center.z + z;
                                
                                commands.push(`setblock ${worldX} ${worldY} ${worldZ} ${blockId}`);
                                blocksPlaced++;
                            }
                        }
                    }
                }
            }
            
            // ブロック数制限チェック
            if (commands.length > 10000) {
                return this.createErrorResponse('Too many blocks to place (maximum 10000)');
            }
            
            try {
                // Socket-BE APIを使用した実装
                let blocksPlaced = 0;
                
                // 基本的な実装：コマンド配列をSocket-BE API呼び出しに変換
                for (const command of commands) {
                    if (command.startsWith('setblock ')) {
                        const parts = command.split(' ');
                        if (parts.length >= 5) {
                            const x = parseInt(parts[1]);
                            const y = parseInt(parts[2]);
                            const z = parseInt(parts[3]);
                            const block = parts[4];
                            
                            await this.world.setBlock({x, y, z}, block);
                            blocksPlaced++;
                            
                            // 制限チェック
                            if (blocksPlaced > 5000) {
                                return this.createErrorResponse('Too many blocks to place (maximum 5000)');
                            }
                        }
                    }
                }
                
                return this.createSuccessResponse(
                    `${hollow ? 'Hollow' : 'Solid'} ellipsoid built with ${blockId} at center (${center.x},${center.y},${center.z}) radii (${radiusXInt},${radiusYInt},${radiusZInt}). Placed ${blocksPlaced} blocks.`,
                    {
                        type: 'ellipsoid',
                        center: center,
                        radiusX: radiusXInt,
                        radiusY: radiusYInt,
                        radiusZ: radiusZInt,
                        material: blockId,
                        hollow: hollow,
                        blocksPlaced: blocksPlaced,
                        apiUsed: 'Socket-BE'
                    }
                );
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