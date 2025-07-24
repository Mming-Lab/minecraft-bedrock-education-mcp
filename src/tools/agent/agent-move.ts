import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * エージェントを移動するツール
 */
export class AgentMoveTool extends BaseTool {
    readonly name = 'agent_move';
    readonly description = 'Move the Minecraft agent (@c selector) in specific directions or teleport to coordinates. Perfect for automated building, exploration, or positioning the agent for tasks. The agent can move step-by-step (1 block at a time) in cardinal directions or be instantly teleported to any location. Essential for agent-based automation and precise positioning. Note: Agent must be spawned first using /summon agent.'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: 'Movement method: "direction" for step-by-step movement (agent move forward), "coordinates" for instant teleportation (tp @c x y z)',
                enum: ['direction', 'coordinates']
            },
            direction: {
                type: 'string',
                description: 'Cardinal direction for agent movement relative to its current facing. "forward" moves in the direction the agent is looking, "back" moves opposite. Perfect for systematic exploration or building patterns.',
                enum: ['forward', 'back', 'left', 'right', 'up', 'down']
            },
            distance: {
                type: 'number',
                description: 'Number of blocks to move in the specified direction. Each unit equals one block. Example: distance=5 moves the agent 5 blocks forward. Executes multiple "agent move" commands in sequence.',
                minimum: 1,
                maximum: 100,
                default: 1
            },
            x: {
                type: 'number',
                description: 'Target X coordinate for teleportation (East/West axis). Example: 100 teleports agent to X=100. Only used when type=coordinates.'
            },
            y: {
                type: 'number',
                description: 'Target Y coordinate for teleportation (height/elevation). Range: -64 to 320. Example: 70 places agent at height Y=70. Only used when type=coordinates.'
            },
            z: {
                type: 'number',
                description: 'Target Z coordinate for teleportation (North/South axis). Example: -50 teleports agent to Z=-50. Only used when type=coordinates.'
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
                
                // agent moveコマンドを使用（複数回実行で距離を制御）
                if (distance === 1) {
                    command = `agent move ${args.direction}`;
                } else {
                    // 複数回実行する場合はbatchを使用
                    const commands = [];
                    for (let i = 0; i < distance; i++) {
                        commands.push(`agent move ${args.direction}`);
                    }
                    const batchResult = await this.executeBatch(commands);
                    return {
                        success: batchResult.success,
                        message: batchResult.success ? 
                            `Agent moved ${distance} blocks ${args.direction}` : 
                            batchResult.message,
                        data: {
                            type: args.type,
                            direction: args.direction,
                            distance: distance
                        }
                    };
                }
                
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