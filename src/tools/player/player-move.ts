import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * プレイヤーを移動・テレポートするツール
 */
export class PlayerMoveTool extends BaseTool {
    readonly name = 'player_move';
    readonly description = 'Move or teleport the player to a specific location';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            x: {
                type: 'number',
                description: 'Target X coordinate'
            },
            y: {
                type: 'number',
                description: 'Target Y coordinate'
            },
            z: {
                type: 'number',
                description: 'Target Z coordinate'
            },
            relative: {
                type: 'boolean',
                description: 'Use relative coordinates (default: false)',
                default: false
            }
        },
        required: ['x', 'y', 'z']
    };

    async execute(args: {
        x: number;
        y: number;
        z: number;
        relative?: boolean;
    }): Promise<ToolCallResult> {
        try {
            const { x, y, z, relative = false } = args;
            
            // 座標の構築
            let command: string;
            if (relative) {
                command = `tp @s ~${x} ~${y} ~${z}`;
            } else {
                command = `tp @s ${x} ${y} ${z}`;
            }

            const result = await this.executeCommand(command);
            
            if (result.success) {
                return {
                    success: true,
                    message: `Player moved to ${relative ? 'relative' : 'absolute'} position (${x}, ${y}, ${z})`,
                    data: {
                        target: { x, y, z },
                        relative: relative
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error moving player: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}