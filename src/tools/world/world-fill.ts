import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ワールドの範囲塗りつぶしツール
 */
export class WorldFillTool extends BaseTool {
    readonly name = 'world_fill';
    readonly description = 'Fill a region with blocks, with advanced options';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            x1: {
                type: 'number',
                description: 'Starting X coordinate'
            },
            y1: {
                type: 'number',
                description: 'Starting Y coordinate'
            },
            z1: {
                type: 'number',
                description: 'Starting Z coordinate'
            },
            x2: {
                type: 'number',
                description: 'Ending X coordinate'
            },
            y2: {
                type: 'number',
                description: 'Ending Y coordinate'
            },
            z2: {
                type: 'number',
                description: 'Ending Z coordinate'
            },
            block: {
                type: 'string',
                description: 'Block type to fill with',
                default: 'minecraft:stone'
            },
            mode: {
                type: 'string',
                description: 'Fill mode',
                enum: ['replace', 'destroy', 'keep', 'outline'],
                default: 'replace'
            },
            replaceBlock: {
                type: 'string',
                description: 'Block to replace (when mode=replace)',
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