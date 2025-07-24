import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * トーラス（ドーナツ型）を建築するツール
 */
export class BuildTorusTool extends BaseTool {
    readonly name = 'build_torus';
    readonly description = 'Build a torus (donut/ring shape) structure. Perfect for decorative rings, circular fountains, arena seating, or portals. Example: majorRadius=15 (outer ring size), minorRadius=4 (tube thickness) creates a large donut fountain';
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
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'majorRadius', 'minorRadius']
    };

    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        majorRadius: number;
        minorRadius: number;
        material?: string;
        hollow?: boolean;
    }): Promise<ToolCallResult> {
        try {
            // 引数の基本検証
            if (!args || typeof args !== 'object') {
                return this.createErrorResponse('Invalid arguments provided');
            }

            if (!this.validateArgs(args)) {
                return this.createErrorResponse('Missing required arguments: centerX, centerY, centerZ, majorRadius, minorRadius');
            }

            const { 
                centerX, 
                centerY, 
                centerZ, 
                majorRadius, 
                minorRadius, 
                material = 'minecraft:stone', 
                hollow = false 
            } = args;
            
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
            
            // トーラス形状の計算
            const minorRadiusSquared = minorRadiusInt * minorRadiusInt;
            const innerMinorRadius = hollow ? Math.max(0, minorRadiusInt - 1) : 0;
            const innerMinorRadiusSquared = innerMinorRadius * innerMinorRadius;
            
            for (let x = -totalRadius; x <= totalRadius; x++) {
                const xSquared = x * x;
                
                for (let z = -totalRadius; z <= totalRadius; z++) {
                    const zSquared = z * z;
                    const distanceFromCenterSquared = xSquared + zSquared;
                    
                    // 中心からの距離を計算（平方根は1回のみ）
                    const distanceFromCenter = Math.sqrt(distanceFromCenterSquared);
                    const distanceFromTubeCenter = Math.abs(distanceFromCenter - majorRadiusInt);
                    
                    // 管の範囲外は早期終了
                    if (distanceFromTubeCenter > minorRadiusInt) continue;
                    
                    // Y範囲を計算で限定
                    const maxYSquared = minorRadiusSquared - (distanceFromTubeCenter * distanceFromTubeCenter);
                    if (maxYSquared < 0) continue;
                    
                    const maxY = Math.floor(Math.sqrt(maxYSquared));
                    
                    for (let y = -maxY; y <= maxY; y++) {
                        const tubeDistanceSquared = distanceFromTubeCenter * distanceFromTubeCenter + y * y;
                        
                        if (tubeDistanceSquared <= minorRadiusSquared &&
                            (!hollow || tubeDistanceSquared >= innerMinorRadiusSquared)) {
                            
                            const worldX = center.x + x;
                            const worldY = center.y + y;
                            const worldZ = center.z + z;
                            
                            commands.push(`setblock ${worldX} ${worldY} ${worldZ} ${blockId}`);
                            blocksPlaced++;
                        }
                    }
                }
            }
            
            // ブロック数制限チェック
            if (commands.length > 8000) {
                return this.createErrorResponse('Too many blocks to place (maximum 8000)');
            }
            
            const result = await this.executeBatch(commands, false);
            
            if (result.success) {
                return this.createSuccessResponse(
                    `${hollow ? 'Hollow' : 'Solid'} torus built with ${blockId} at center (${center.x},${center.y},${center.z}) major radius ${majorRadiusInt}, minor radius ${minorRadiusInt}`,
                    {
                        type: 'torus',
                        center: center,
                        majorRadius: majorRadiusInt,
                        minorRadius: minorRadiusInt,
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
                `Error building torus: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}