import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * 円柱を建築するツール
 */
export class BuildCylinderTool extends BaseTool {
    readonly name = 'build_cylinder';
    readonly description = 'Build a CYLINDER (round tower/pillar). USE THIS when user asks for: "tower", "pillar", "column", "chimney", "round building", "circular tower", "pipe", "tube". ALWAYS specify: centerX, centerY, centerZ, radius, height. Example: centerX=0, centerY=64, centerZ=0, radius=5, height=20';
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
            
            const result = await this.executeBatch(commands, false);
            
            if (result.success) {
                return this.createSuccessResponse(
                    `${hollow ? 'Hollow' : 'Solid'} cylinder built with ${blockId} at center (${center.x},${center.y},${center.z}) radius ${radiusInt}, height ${heightInt}, axis ${axis}`,
                    {
                        type: 'cylinder',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
                        material: blockId,
                        hollow: hollow,
                        axis: axis,
                        blocksPlaced: blocksPlaced
                    }
                );
            } else {
                return result;
            }

        } catch (error) {
            return this.createErrorResponse(
                `Error building cylinder: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}