import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * 球体を建築するツール
 */
export class BuildSphereTool extends BaseTool {
    readonly name = 'build_sphere';
    readonly description = 'Build a sphere structure with specified center, radius and material';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
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
            radius: {
                type: 'number',
                description: 'Radius of the sphere',
                minimum: 1,
                maximum: 20
            },
            material: {
                type: 'string',
                description: 'Block material to use',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Create hollow sphere (default: false)',
                default: false
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius']
    };

    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        material?: string;
        hollow?: boolean;
    }): Promise<ToolCallResult> {
        try {
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
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            // 球体の各点を計算
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
                            commands.push(`setblock ${x} ${y} ${z} ${blockId}`);
                            blocksPlaced++;
                        }
                    }
                }
            }
            
            if (commands.length > 1000) {
                return {
                    success: false,
                    message: 'Too many blocks to place (maximum 1000)'
                };
            }
            
            const result = await this.executeBatch(commands, false);
            
            if (result.success) {
                return {
                    success: true,
                    message: `${hollow ? 'Hollow' : 'Solid'} sphere built with ${blockId} at center (${center.x},${center.y},${center.z}) with radius ${radius}`,
                    data: {
                        type: 'sphere',
                        center: center,
                        radius: radius,
                        material: blockId,
                        hollow: hollow,
                        blocksPlaced: blocksPlaced
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error building sphere: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}