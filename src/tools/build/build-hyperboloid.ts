import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ハイパーボロイド（冷却塔状）を建築するツール
 */
export class BuildHyperboloidTool extends BaseTool {
    readonly name = 'build_hyperboloid';
    readonly description = 'Build a HYPERBOLOID (cooling tower shape). USE THIS when user asks for: "hyperboloid", "cooling tower", "hourglass", "tower", "nuclear tower". ALWAYS specify: centerX, centerY, centerZ, baseRadius, waistRadius, height. Example: centerX=100, centerY=70, centerZ=200, baseRadius=10, waistRadius=5, height=20';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            centerX: {
                type: 'number',
                description: 'Center X coordinate (east-west position of hyperboloid base center)'
            },
            centerY: {
                type: 'number',
                description: 'Center Y coordinate (height/vertical position of hyperboloid base, typically 64-100)'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate (north-south position of hyperboloid base center)'
            },
            baseRadius: {
                type: 'number',
                description: 'Radius at the base in blocks. Small: 5-8, Medium: 10-15, Large: 20-30',
                minimum: 3,
                maximum: 50
            },
            waistRadius: {
                type: 'number',
                description: 'Radius at the narrowest point (waist) in blocks. Should be smaller than baseRadius',
                minimum: 1,
                maximum: 30
            },
            height: {
                type: 'number',
                description: 'Total height of the hyperboloid in blocks. Small: 10-15, Medium: 20-30, Large: 40-60',
                minimum: 4,
                maximum: 100
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone, glass, wool, concrete, etc.)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for tower shell, or solid (false) for full hyperboloid',
                default: false
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'baseRadius', 'waistRadius', 'height']
    };

    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        baseRadius: number;
        waistRadius: number;
        height: number;
        material?: string;
        hollow?: boolean;
    }): Promise<ToolCallResult> {
        try {
            const { centerX, centerY, centerZ, baseRadius, waistRadius, height, material = 'minecraft:stone', hollow = false } = args;
            
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
                    message: 'Hyperboloid extends beyond valid Y coordinates (-64 to 320)'
                };
            }
            
            // パラメータの検証
            if (baseRadius < 3 || baseRadius > 50) {
                return {
                    success: false,
                    message: 'Base radius must be between 3 and 50'
                };
            }
            
            if (waistRadius < 1 || waistRadius > 30) {
                return {
                    success: false,
                    message: 'Waist radius must be between 1 and 30'
                };
            }
            
            if (waistRadius >= baseRadius) {
                return {
                    success: false,
                    message: 'Waist radius must be smaller than base radius'
                };
            }
            
            if (height < 4 || height > 100) {
                return {
                    success: false,
                    message: 'Height must be between 4 and 100'
                };
            }
            
            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            const baseRadiusInt = Math.round(baseRadius);
            const waistRadiusInt = Math.round(waistRadius);
            const heightInt = Math.round(height);
            const halfHeight = Math.floor(heightInt / 2);
            
            // 双曲面の形状パラメータ
            const a = waistRadiusInt; // 最小半径
            const b = baseRadiusInt - waistRadiusInt; // 半径の変化幅
            
            for (let y = 0; y < heightInt; y++) {
                // 中心からの距離 (-1 to 1 の範囲)
                const t = (y - halfHeight) / halfHeight;
                
                // 双曲面の方程式: r(t) = a * sqrt(1 + (t*b/a)²)
                const currentRadius = a * Math.sqrt(1 + (t * b / a) * (t * b / a));
                const currentRadiusInt = Math.round(currentRadius);
                const currentRadiusSquared = currentRadiusInt * currentRadiusInt;
                
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
                    message: `${hollow ? 'Hollow' : 'Solid'} hyperboloid built with ${blockId} at center (${center.x},${center.y},${center.z}) with base radius ${baseRadiusInt}, waist radius ${waistRadiusInt}, and height ${heightInt}`,
                    data: {
                        type: 'hyperboloid',
                        center: center,
                        baseRadius: baseRadiusInt,
                        waistRadius: waistRadiusInt,
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
                message: `Error building hyperboloid: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}