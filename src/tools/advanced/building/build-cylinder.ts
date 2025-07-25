import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

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
                centerX, 
                centerY, 
                centerZ, 
                radius, 
                height, 
                material = 'minecraft:stone', 
                hollow = false,
                axis = 'y'
            } = args;
            
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
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            // 円柱の各点を計算
            const radiusSquared = radiusInt * radiusInt;
            const innerRadius = hollow ? Math.max(0, radiusInt - 1) : 0;
            const innerRadiusSquared = innerRadius * innerRadius;
            
            for (let i = 0; i < heightInt; i++) {
                for (let u = -radiusInt; u <= radiusInt; u++) {
                    const uSquared = u * u;
                    if (uSquared > radiusSquared) continue;
                    
                    const maxVSquared = radiusSquared - uSquared;
                    const maxV = Math.floor(Math.sqrt(maxVSquared));
                    
                    for (let v = -maxV; v <= maxV; v++) {
                        const distanceSquared = uSquared + v * v;
                        
                        if (distanceSquared <= radiusSquared &&
                            (!hollow || distanceSquared >= innerRadiusSquared)) {
                            
                            let x, y, z;
                            
                            // 軸に応じて座標を変換
                            if (axis === 'y') {
                                x = center.x + u;
                                y = center.y + i;
                                z = center.z + v;
                            } else if (axis === 'x') {
                                x = center.x + i;
                                y = center.y + u;
                                z = center.z + v;
                            } else { // axis === 'z'
                                x = center.x + u;
                                y = center.y + v;
                                z = center.z + i;
                            }
                            
                            commands.push(`setblock ${x} ${y} ${z} ${blockId}`);
                            blocksPlaced++;
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
                    `${hollow ? 'Hollow' : 'Solid'} cylinder built with ${blockId} at center (${center.x},${center.y},${center.z}) radius ${radiusInt}, height ${heightInt}, axis ${axis}. Placed ${blocksPlaced} blocks.`,
                    {
                        type: 'cylinder',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
                        material: blockId,
                        hollow: hollow,
                        axis: axis,
                        blocksPlaced: blocksPlaced,
                        apiUsed: 'Socket-BE'
                    }
                );
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