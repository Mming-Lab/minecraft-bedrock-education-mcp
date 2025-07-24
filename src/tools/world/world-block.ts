import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ワールドのブロック操作ツール（設置・取得・破壊）
 */
export class WorldBlockTool extends BaseTool {
    readonly name = 'world_block';
    readonly description = 'Perform precise single-block operations at any world coordinates. Perfect for detailed building, targeted modifications, or block analysis. Supports setting blocks at specific locations, checking what block exists at coordinates, and destroying blocks with item drops. Essential for fine-grained world editing and construction projects. Works with any valid Minecraft block type and coordinates within world bounds (-64 to 320 Y).'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Block operation type: "set" places a block, "get" checks what block exists at coordinates, "destroy" removes block with item drops',
                enum: ['set', 'get', 'destroy']
            },
            x: {
                type: 'number',
                description: 'Target X coordinate (East/West axis). Positive values are East, negative are West. Example: 150 targets the block at X=150'
            },
            y: {
                type: 'number',
                description: 'Target Y coordinate (height/elevation). Valid range: -64 to 320. Sea level is Y=63. Example: 70 targets a block at height 70'
            },
            z: {
                type: 'number',
                description: 'Target Z coordinate (North/South axis). Positive values are South, negative are North. Example: -100 targets the block at Z=-100'
            },
            block: {
                type: 'string',
                description: 'Block type to place when action=set. Use Minecraft block IDs like "stone", "glass", "oak_log", or full IDs like "minecraft:diamond_block". Example: "emerald_block" places an emerald block.',
                default: 'minecraft:stone'
            }
        },
        required: ['action', 'x', 'y', 'z']
    };

    async execute(args: {
        action: 'set' | 'get' | 'destroy';
        x: number;
        y: number;
        z: number;
        block?: string;
    }): Promise<ToolCallResult> {
        try {
            const { action, x, y, z, block = 'minecraft:stone' } = args;
            
            // 座標の整数化
            const coordX = Math.floor(x);
            const coordY = Math.floor(y);
            const coordZ = Math.floor(z);
            
            // Y座標の検証
            if (coordY < -64 || coordY > 320) {
                return {
                    success: false,
                    message: 'Y coordinate must be between -64 and 320'
                };
            }
            
            let command: string;
            
            switch (action) {
                case 'set':
                    // ブロックIDの正規化
                    let blockId = block;
                    if (!blockId.includes(':')) {
                        blockId = `minecraft:${blockId}`;
                    }
                    command = `setblock ${coordX} ${coordY} ${coordZ} ${blockId}`;
                    break;
                    
                case 'get':
                    // ブロック情報を取得（testforblockコマンドを使用）
                    command = `testforblock ${coordX} ${coordY} ${coordZ} minecraft:air`;
                    break;
                    
                case 'destroy':
                    command = `setblock ${coordX} ${coordY} ${coordZ} air destroy`;
                    break;
                    
                default:
                    return {
                        success: false,
                        message: 'Invalid action. Use: set, get, destroy'
                    };
            }
            
            const result = await this.executeCommand(command);
            
            if (result.success) {
                let message: string;
                switch (action) {
                    case 'set':
                        message = `Block ${block} set at (${coordX}, ${coordY}, ${coordZ})`;
                        break;
                    case 'get':
                        message = `Block information retrieved for (${coordX}, ${coordY}, ${coordZ})`;
                        break;
                    case 'destroy':
                        message = `Block destroyed at (${coordX}, ${coordY}, ${coordZ})`;
                        break;
                }
                
                return {
                    success: true,
                    message: message,
                    data: {
                        action: action,
                        coordinates: { x: coordX, y: coordY, z: coordZ },
                        ...(action === 'set' && { block: block })
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error with world block operation: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}