import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * エージェントを移動するツール
 */
export class AgentMoveTool extends BaseTool {
    readonly name = 'agent_move';
    readonly description = 'Move the agent in a specific direction or to specific coordinates';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: 'Movement type: direction or coordinates',
                enum: ['direction', 'coordinates']
            },
            direction: {
                type: 'string',
                description: 'Direction to move (when type=direction)',
                enum: ['forward', 'back', 'left', 'right', 'up', 'down']
            },
            distance: {
                type: 'number',
                description: 'Distance to move in blocks (when type=direction)',
                minimum: 1,
                maximum: 100,
                default: 1
            },
            x: {
                type: 'number',
                description: 'Target X coordinate (when type=coordinates)'
            },
            y: {
                type: 'number',
                description: 'Target Y coordinate (when type=coordinates)'
            },
            z: {
                type: 'number',
                description: 'Target Z coordinate (when type=coordinates)'
            }
        },
        required: ['type']
    };

    async execute(args: {
        type: 'direction' | 'coordinates';
        direction?: string;
        distance?: number;
        x?: number;
        y?: number;
        z?: number;
    }): Promise<ToolCallResult> {
        try {
            let command: string;
            
            if (args.type === 'direction') {
                if (!args.direction) {
                    return {
                        success: false,
                        message: 'Direction is required when type=direction'
                    };
                }
                
                const distance = args.distance || 1;
                const directionMap = {
                    forward: `~0 ~0 ~${distance}`,
                    back: `~0 ~0 ~-${distance}`,
                    left: `~-${distance} ~0 ~0`,
                    right: `~${distance} ~0 ~0`,
                    up: `~0 ~${distance} ~0`,
                    down: `~0 ~-${distance} ~0`
                };
                
                const coords = directionMap[args.direction as keyof typeof directionMap];
                command = `tp @c ${coords}`;
                
            } else if (args.type === 'coordinates') {
                if (args.x === undefined || args.y === undefined || args.z === undefined) {
                    return {
                        success: false,
                        message: 'X, Y, Z coordinates are required when type=coordinates'
                    };
                }
                
                command = `tp @c ${args.x} ${args.y} ${args.z}`;
            } else {
                return {
                    success: false,
                    message: 'Invalid movement type. Use "direction" or "coordinates"'
                };
            }

            const result = await this.executeCommand(command);
            
            if (result.success) {
                let message: string;
                if (args.type === 'direction') {
                    message = `Agent moved ${args.distance || 1} blocks ${args.direction}`;
                } else {
                    message = `Agent moved to coordinates (${args.x}, ${args.y}, ${args.z})`;
                }
                
                return {
                    success: true,
                    message: message,
                    data: {
                        type: args.type,
                        ...(args.type === 'direction' ? 
                            { direction: args.direction, distance: args.distance || 1 } :
                            { x: args.x, y: args.y, z: args.z })
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error moving agent: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}