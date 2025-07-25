import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

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
    readonly description = 'Build SPHERE: ball, dome, round structure, planet, orb. Requires: centerX,centerY,centerZ,radius';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
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
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        material?: string;
        hollow?: boolean;
    }): Promise<ToolCallResult> {
        try {
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: "World not available. Ensure Minecraft is connected." };
            }

            const { centerX, centerY, centerZ, radius, material = 'minecraft:stone', hollow = false } = args;
            
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
                let blocksPlaced = 0;
                
                // Socket-BE APIで球体の各点を配置
                for (let x = center.x - radius; x <= center.x + radius; x++) {
                    for (let y = center.y - radius; y <= center.y + radius; y++) {
                        for (let z = center.z - radius; z <= center.z + radius; z++) {
                            const distance = Math.sqrt(
                                Math.pow(x - center.x, 2) + 
                                Math.pow(y - center.y, 2) + 
                                Math.pow(z - center.z, 2)
                            );
                            
                            let shouldPlace = false;
                            
                            if (hollow) {
                                // 中空の球体：表面のみ
                                shouldPlace = distance <= radius && distance >= radius - 1;
                            } else {
                                // 実体の球体：内部も含む
                                shouldPlace = distance <= radius;
                            }
                            
                            if (shouldPlace) {
                                await this.world.setBlock({x, y, z}, blockId);
                                blocksPlaced++;
                                
                                // 大きな球体の場合は進捗制限
                                if (blocksPlaced > 1000) {
                                    return {
                                        success: false,
                                        message: 'Too many blocks to place (maximum 1000)'
                                    };
                                }
                            }
                        }
                    }
                }

                return {
                    success: true,
                    message: `${hollow ? 'Hollow' : 'Solid'} sphere built with ${blockId} at center (${center.x},${center.y},${center.z}) with radius ${radius}. Placed ${blocksPlaced} blocks.`,
                    data: {
                        type: 'sphere',
                        center: center,
                        radius: radius,
                        material: blockId,
                        hollow: hollow,
                        blocksPlaced: blocksPlaced,
                        apiUsed: 'Socket-BE'
                    }
                };
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