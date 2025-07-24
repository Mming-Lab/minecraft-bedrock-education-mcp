import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ワールドの範囲塗りつぶしツール
 */
export class WorldFillTool extends BaseTool {
    readonly name = 'world_fill';
    readonly description = 'Fill large 3D regions with blocks using advanced fill modes for efficient large-scale construction. Perfect for building foundations, clearing areas, creating structures, or mass terrain modification. Supports multiple fill modes: replace specific blocks, destroy existing blocks, keep only empty spaces, or create hollow outlines. Essential for megabuilds, landscaping, and rapid construction. Maximum volume: 32,768 blocks per operation.'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            x1: {
                type: 'number',
                description: 'Starting corner X coordinate (East/West). Defines one corner of the fill region. Example: x1=50 for the western edge at X=50'
            },
            y1: {
                type: 'number',
                description: 'Starting corner Y coordinate (height). Range: -64 to 320. Defines bottom of fill region. Example: y1=60 for ground level'
            },
            z1: {
                type: 'number',
                description: 'Starting corner Z coordinate (North/South). Defines one corner of the fill region. Example: z1=100 for the northern edge at Z=100'
            },
            x2: {
                type: 'number',
                description: 'Ending corner X coordinate (East/West). Defines opposite corner from x1. Example: x2=100 creates a 50-block wide region if x1=50'
            },
            y2: {
                type: 'number',
                description: 'Ending corner Y coordinate (height). Range: -64 to 320. Defines top of fill region. Example: y2=80 creates a 20-block tall region if y1=60'
            },
            z2: {
                type: 'number',
                description: 'Ending corner Z coordinate (North/South). Defines opposite corner from z1. Example: z2=150 creates a 50-block deep region if z1=100'
            },
            block: {
                type: 'string',
                description: 'Block type to fill the region with. Use Minecraft block IDs like "concrete", "wood", "glass", or full IDs like "minecraft:gold_block". Example: "white_concrete" for clean building material.',
                default: 'minecraft:stone'
            },
            mode: {
                type: 'string',
                description: 'Fill behavior: "replace" swaps specific blocks, "destroy" breaks existing blocks, "keep" only fills air spaces, "outline" creates hollow shell',
                enum: ['replace', 'destroy', 'keep', 'outline'],
                default: 'replace'
            },
            replaceBlock: {
                type: 'string',
                description: 'Specific block type to replace when mode=replace. Only blocks of this type will be changed to the new block. Example: "dirt" replaces only dirt blocks with the target block.',
                default: 'minecraft:air'
            }
        },
        required: ['x1', 'y1', 'z1', 'x2', 'y2', 'z2']
    };

    async execute(args: {
        x1: number;
        y1: number;
        z1: number;
        x2: number;
        y2: number;
        z2: number;
        block?: string;
        mode?: string;
        replaceBlock?: string;
    }): Promise<ToolCallResult> {
        try {
            const { 
                x1, y1, z1, x2, y2, z2, 
                block = 'minecraft:stone', 
                mode = 'replace',
                replaceBlock = 'minecraft:air'
            } = args;
            
            // 座標の整数化
            const coords = {
                x1: Math.floor(x1),
                y1: Math.floor(y1),
                z1: Math.floor(z1),
                x2: Math.floor(x2),
                y2: Math.floor(y2),
                z2: Math.floor(z2)
            };
            
            // Y座標の検証
            if (coords.y1 < -64 || coords.y1 > 320 || coords.y2 < -64 || coords.y2 > 320) {
                return {
                    success: false,
                    message: 'Y coordinates must be between -64 and 320'
                };
            }
            
            // 範囲の検証
            const volume = Math.abs(coords.x2 - coords.x1 + 1) * Math.abs(coords.y2 - coords.y1 + 1) * Math.abs(coords.z2 - coords.z1 + 1);
            if (volume > 32768) {
                return {
                    success: false,
                    message: 'Volume too large (maximum 32768 blocks)'
                };
            }
            
            // ブロックIDの正規化
            let blockId = block;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }
            
            let replaceBlockId = replaceBlock;
            if (!replaceBlockId.includes(':')) {
                replaceBlockId = `minecraft:${replaceBlockId}`;
            }
            
            let commands: string[] = [];
            
            switch (mode) {
                case 'replace':
                    // 指定ブロックを置換
                    commands.push(`fill ${coords.x1} ${coords.y1} ${coords.z1} ${coords.x2} ${coords.y2} ${coords.z2} ${blockId} replace ${replaceBlockId}`);
                    break;
                    
                case 'destroy':
                    // 破壊効果付きで塗りつぶし
                    commands.push(`fill ${coords.x1} ${coords.y1} ${coords.z1} ${coords.x2} ${coords.y2} ${coords.z2} ${blockId} destroy`);
                    break;
                    
                case 'keep':
                    // 空気ブロックのみ置換
                    commands.push(`fill ${coords.x1} ${coords.y1} ${coords.z1} ${coords.x2} ${coords.y2} ${coords.z2} ${blockId} keep`);
                    break;
                    
                case 'outline':
                    // 外枠のみ作成
                    commands.push(`fill ${coords.x1} ${coords.y1} ${coords.z1} ${coords.x2} ${coords.y2} ${coords.z2} ${blockId} outline`);
                    break;
                    
                default:
                    return {
                        success: false,
                        message: 'Invalid mode. Use: replace, destroy, keep, outline'
                    };
            }
            
            const result = await this.executeBatch(commands, true);
            
            if (result.success) {
                return {
                    success: true,
                    message: `Region filled with ${blockId} from (${coords.x1},${coords.y1},${coords.z1}) to (${coords.x2},${coords.y2},${coords.z2}) using ${mode} mode`,
                    data: {
                        from: { x: coords.x1, y: coords.y1, z: coords.z1 },
                        to: { x: coords.x2, y: coords.y2, z: coords.z2 },
                        block: blockId,
                        mode: mode,
                        volume: volume,
                        ...(mode === 'replace' && { replaceBlock: replaceBlockId })
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error filling region: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}