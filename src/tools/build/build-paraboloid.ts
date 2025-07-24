import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * パラボロイド（衛星皿状）を建築するツール
 */
export class BuildParaboloidTool extends BaseTool {
    readonly name = 'build_paraboloid';
    readonly description = 'Build a PARABOLOID (satellite dish shape). USE THIS when user asks for: "paraboloid", "satellite dish", "bowl", "dish", "parabolic". ALWAYS specify: centerX, centerY, centerZ, radius, height. Example: centerX=100, centerY=70, centerZ=200, radius=8, height=10';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            centerX: {
                type: 'number',
                description: 'Center X coordinate (east-west position of paraboloid base center)'
            },
            centerY: {
                type: 'number',
                description: 'Center Y coordinate (height/vertical position of paraboloid base, typically 64-100)'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate (north-south position of paraboloid base center)'
            },
            radius: {
                type: 'number',
                description: 'Maximum radius at the top of the paraboloid in blocks. Small: 3-5, Medium: 8-12, Large: 15-20',
                minimum: 2,
                maximum: 50
            },
            height: {
                type: 'number',
                description: 'Height of the paraboloid in blocks. Small: 5-8, Medium: 10-15, Large: 20-30',
                minimum: 1,
                maximum: 50
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone, glass, wool, concrete, etc.)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for dish shell, or solid (false) for full paraboloid',
                default: false
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius', 'height']
    };

    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        height: number;
        material?: string;
        hollow?: boolean;
    }): Promise<ToolCallResult> {
        try {
            const { centerX, centerY, centerZ, radius, height, material = 'minecraft:stone', hollow = false } = args;
            
            // 座標の整数化
            const center = {
                x: Math.floor(centerX),
                y: Math.floor(centerY),
                z: Math.floor(centerZ)
            };
            
            // Y座標の検証
            if (center.y < -64 || center.y + height > 320) {
                return {
                    success: false,
                    message: 'Paraboloid extends beyond valid Y coordinates (-64 to 320)'
                };
            }
            
            // 半径と高さの検証
            if (radius < 2 || radius > 50) {
                return {
                    success: false,
                    message: 'Radius must be between 2 and 50'
                };
            }
            
            if (height < 1 || height > 50) {
                return {
                    success: false,
                    message: 'Height must be between 1 and 50'
                };
            }
            
            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            const radiusInt = Math.round(radius);
            const heightInt = Math.round(height);
            const radiusSquared = radiusInt * radiusInt;
            
            // パラボロイドの方程式: z = (x² + y²) / (4 * focal_length)
            // focal_lengthを調整してheightに合わせる
            const focalLength = radiusSquared / (4 * heightInt);
            
            for (let y = 0; y < heightInt; y++) {
                // 現在の高さでのパラボラ半径を計算
                const currentRadiusSquared = 4 * focalLength * y;
                const currentRadius = Math.sqrt(currentRadiusSquared);
                const currentRadiusInt = Math.floor(currentRadius);
                
                if (currentRadiusInt > radiusInt) continue; // 最大半径を超えた場合はスキップ
                
                const innerRadius = hollow ? Math.max(0, currentRadiusInt - 1) : 0;
                const innerRadiusSquared = innerRadius * innerRadius;
                
                for (let x = -currentRadiusInt; x <= currentRadiusInt; x++) {
                    const xSquared = x * x;
                    if (xSquared > currentRadiusSquared) continue;
                    
                    const maxZSquared = currentRadiusSquared - xSquared;
                    const maxZ = Math.floor(Math.sqrt(maxZSquared));
                    
                    for (let z = -maxZ; z <= maxZ; z++) {
                        const distanceSquared = xSquared + z * z;
                        
                        if (distanceSquared <= currentRadiusSquared &&
                            (!hollow || distanceSquared >= innerRadiusSquared)) {
                            const worldX = center.x + x;
                            const worldY = center.y + y;
                            const worldZ = center.z + z;
                            
                            commands.push(`setblock ${worldX} ${worldY} ${worldZ} ${blockId}`);
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
                    message: `${hollow ? 'Hollow' : 'Solid'} paraboloid built with ${blockId} at center (${center.x},${center.y},${center.z}) with radius ${radiusInt} and height ${heightInt}`,
                    data: {
                        type: 'paraboloid',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
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
                message: `Error building paraboloid: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}