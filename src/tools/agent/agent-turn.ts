import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * エージェントの向きを変更するツール
 */
export class AgentTurnTool extends BaseTool {
    readonly name = 'agent_turn';
    readonly description = 'Turn the agent left or right, or set specific rotation';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: 'Turn type: relative or absolute',
                enum: ['relative', 'absolute']
            },
            direction: {
                type: 'string',
                description: 'Direction to turn (when type=relative)',
                enum: ['left', 'right']
            },
            degrees: {
                type: 'number',
                description: 'Degrees to turn (when type=relative, default: 90)',
                minimum: 1,
                maximum: 360,
                default: 90
            },
            yaw: {
                type: 'number',
                description: 'Target yaw rotation (when type=absolute)',
                minimum: -180,
                maximum: 180
            },
            pitch: {
                type: 'number',
                description: 'Target pitch rotation (when type=absolute)',
                minimum: -90,
                maximum: 90,
                default: 0
            }
        },
        required: ['type']
    };

    async execute(args: {
        type: 'relative' | 'absolute';
        direction?: 'left' | 'right';
        degrees?: number;
        yaw?: number;
        pitch?: number;
    }): Promise<ToolCallResult> {
        try {
            let command: string;
            
            if (args.type === 'relative') {
                if (!args.direction) {
                    return {
                        success: false,
                        message: 'Direction is required when type=relative'
                    };
                }
                
                const degrees = args.degrees || 90;
                const turnAmount = args.direction === 'left' ? -degrees : degrees;
                
                // 相対回転: 現在の向きから指定度数回転
                command = `tp @c ~ ~ ~ ~${turnAmount} ~`;
                
            } else if (args.type === 'absolute') {
                if (args.yaw === undefined) {
                    return {
                        success: false,
                        message: 'Yaw is required when type=absolute'
                    };
                }
                
                const pitch = args.pitch || 0;
                command = `tp @c ~ ~ ~ ${args.yaw} ${pitch}`;
                
            } else {
                return {
                    success: false,
                    message: 'Invalid turn type. Use "relative" or "absolute"'
                };
            }

            const result = await this.executeCommand(command);
            
            if (result.success) {
                let message: string;
                if (args.type === 'relative') {
                    message = `Agent turned ${args.direction} ${args.degrees || 90} degrees`;
                } else {
                    message = `Agent rotation set to yaw=${args.yaw}, pitch=${args.pitch || 0}`;
                }
                
                return {
                    success: true,
                    message: message,
                    data: {
                        type: args.type,
                        ...(args.type === 'relative' ? 
                            { direction: args.direction, degrees: args.degrees || 90 } :
                            { yaw: args.yaw, pitch: args.pitch || 0 })
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error turning agent: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}