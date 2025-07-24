import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * プレイヤーを移動・テレポートするツール
 */
export class PlayerMoveTool extends BaseTool {
    readonly name = 'player_move';
    readonly description = 'Instantly teleport the player to any location in the Minecraft world using absolute or relative coordinates. Perfect for fast travel, escaping danger, reaching build sites, or positioning for screenshots. Supports both absolute coordinates (e.g., X=100, Y=70, Z=200) and relative movement (e.g., move 5 blocks forward from current position). Essential for efficient world navigation.'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            x: {
                type: 'number',
                description: 'Target X coordinate (East/West axis). Positive values go East, negative go West. Example: 100 for coordinates X=100'
            },
            y: {
                type: 'number',
                description: 'Target Y coordinate (height/elevation). Range: -64 to 320. Sea level is Y=63. Example: 70 for a safe height above ground'
            },
            z: {
                type: 'number',
                description: 'Target Z coordinate (North/South axis). Positive values go South, negative go North. Example: -50 for coordinates Z=-50'
            },
            relative: {
                type: 'boolean',
                description: 'Use relative movement from current position instead of absolute coordinates. When true, X=5 means "move 5 blocks East from here". Perfect for small adjustments like "move up 10 blocks" or "step back 3 blocks"',
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