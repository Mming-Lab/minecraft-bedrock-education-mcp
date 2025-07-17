import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * 直線を建築するツール
 */
export class BuildLineTool extends BaseTool {
    readonly name = 'build_line';
    readonly description = 'Build a straight line of blocks between two points';
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
            material: {
                type: 'string',
                description: 'Block material to use',
                default: 'minecraft:stone'
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
        material?: string;
    }): Promise<ToolCallResult> {
        try {
            const { x1, y1, z1, x2, y2, z2, material = 'minecraft:stone' } = args;
            
            // 座標の整数化
            const start = {
                x: Math.floor(x1),
                y: Math.floor(y1),
                z: Math.floor(z1)
            };
            const end = {
                x: Math.floor(x2),
                y: Math.floor(y2),
                z: Math.floor(z2)
            };
            
            // Y座標の検証
            if (start.y < -64 || start.y > 320 || end.y < -64 || end.y > 320) {
                return {
                    success: false,
                    message: 'Y coordinates must be between -64 and 320'
                };
            }
            
            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }
            
            // 直線の長さを計算
            const distance = Math.sqrt(
                Math.pow(end.x - start.x, 2) + 
                Math.pow(end.y - start.y, 2) + 
                Math.pow(end.z - start.z, 2)
            );
            
            if (distance > 100) {
                return {
                    success: false,
                    message: 'Line too long (maximum 100 blocks)'
                };
            }
            
            // 直線上の点を計算
            const steps = Math.ceil(distance);
            const commands: string[] = [];
            
            for (let i = 0; i <= steps; i++) {
                const t = steps === 0 ? 0 : i / steps;
                const x = Math.floor(start.x + (end.x - start.x) * t);
                const y = Math.floor(start.y + (end.y - start.y) * t);
                const z = Math.floor(start.z + (end.z - start.z) * t);
                
                commands.push(`setblock ${x} ${y} ${z} ${blockId}`);
            }
            
            // 重複する座標を除去
            const uniqueCommands = [...new Set(commands)];
            
            if (uniqueCommands.length > 100) {
                return {
                    success: false,
                    message: 'Too many blocks to place (maximum 100)'
                };
            }
            
            const result = await this.executeBatch(uniqueCommands, false);
            
            if (result.success) {
                return {
                    success: true,
                    message: `Line built with ${blockId} from (${start.x},${start.y},${start.z}) to (${end.x},${end.y},${end.z})`,
                    data: {
                        type: 'line',
                        from: start,
                        to: end,
                        material: blockId,
                        length: distance,
                        blocksPlaced: uniqueCommands.length
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error building line: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}