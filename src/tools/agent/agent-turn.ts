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
                
                // agent turnコマンドを使用（90度単位での回転）
                if (degrees === 90) {
                    command = `agent turn ${args.direction}`;
                } else {
                    // 90度以外の場合は複数回実行
                    const turnCount = Math.floor(degrees / 90);
                    if (turnCount > 0) {
                        const commands = [];
                        for (let i = 0; i < turnCount; i++) {
                            commands.push(`agent turn ${args.direction}`);
                        }
                        const batchResult = await this.executeBatch(commands);
                        return {
                            success: batchResult.success,
                            message: batchResult.success ? 
                                `Agent turned ${args.direction} ${degrees} degrees` : 
                                batchResult.message,
                            data: {
                                type: args.type,
                                direction: args.direction,
                                degrees: degrees
                            }
                        };
                    } else {
                        return {
                            success: false,
                            message: 'Degrees must be at least 90 (agent can only turn in 90-degree increments)'
                        };
                    }
                }
                
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