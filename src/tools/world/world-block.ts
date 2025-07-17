import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ワールドのブロック操作ツール（設置・取得・破壊）
 */
export class WorldBlockTool extends BaseTool {
    readonly name = 'world_block';
    readonly description = 'Perform block operations in the world (set, get, destroy)';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Action to perform',
                enum: ['set', 'get', 'destroy']
            },
            x: {
                type: 'number',
                description: 'X coordinate'
            },
            y: {
                type: 'number',
                description: 'Y coordinate'
            },
            z: {
                type: 'number',
                description: 'Z coordinate'
            },
            block: {
                type: 'string',
                description: 'Block type (when action=set)',
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