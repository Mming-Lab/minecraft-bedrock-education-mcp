import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * 楕円体を建築するツール
 */
export class BuildEllipsoidTool extends BaseTool {
    readonly name = 'build_ellipsoid';
    readonly description = 'Build an ellipsoid (stretched/oval sphere) structure. Perfect for egg shapes, stretched domes, oval rooms, or artistic sculptures. Different radii create unique shapes. Example: radiusX=10, radiusY=5, radiusZ=10 creates a flattened dome';
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

    async execute(args: {
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
            // 引数の基本検証
            if (!args || typeof args !== 'object') {
                return this.createErrorResponse('Invalid arguments provided');
            }

            if (!this.validateArgs(args)) {
                return this.createErrorResponse('Missing required arguments: centerX, centerY, centerZ, radiusX, radiusY, radiusZ');
            }

            const { 
                centerX, 
                centerY, 
                centerZ, 
                radiusX, 
                radiusY, 
                radiusZ, 
                material = 'minecraft:stone', 
                hollow = false 
            } = args;
            
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
            
            const result = await this.executeBatch(commands, false);
            
            if (result.success) {
                return this.createSuccessResponse(
                    `${hollow ? 'Hollow' : 'Solid'} ellipsoid built with ${blockId} at center (${center.x},${center.y},${center.z}) radii (${radiusXInt},${radiusYInt},${radiusZInt})`,
                    {
                        type: 'ellipsoid',
                        center: center,
                        radiusX: radiusXInt,
                        radiusY: radiusYInt,
                        radiusZ: radiusZInt,
                        material: blockId,
                        hollow: hollow,
                        blocksPlaced: blocksPlaced
                    }
                );
            } else {
                return result;
            }

        } catch (error) {
            return this.createErrorResponse(
                `Error building ellipsoid: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}