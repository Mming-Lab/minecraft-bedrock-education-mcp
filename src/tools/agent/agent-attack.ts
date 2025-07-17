import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * エージェントが攻撃するツール
 */
export class AgentAttackTool extends BaseTool {
    readonly name = 'agent_attack';
    readonly description = 'Make the agent attack in a specific direction';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            direction: {
                type: 'string',
                description: 'Direction to attack',
                enum: ['forward', 'back', 'left', 'right', 'up', 'down']
            },
            times: {
                type: 'number',
                description: 'Number of times to attack (default: 1)',
                minimum: 1,
                maximum: 10,
                default: 1
            }
        },
        required: ['direction']
    };

    async execute(args: {
        direction: string;
        times?: number;
    }): Promise<ToolCallResult> {
        try {
            const { direction, times = 1 } = args;
            
            // 方向に基づいて攻撃対象の座標を決定
            const directionMap = {
                forward: '~ ~ ~1',
                back: '~ ~ ~-1',
                left: '~-1 ~ ~',
                right: '~1 ~ ~',
                up: '~ ~1 ~',
                down: '~ ~-1 ~'
            };
            
            const targetCoords = directionMap[direction as keyof typeof directionMap];
            if (!targetCoords) {
                return {
                    success: false,
                    message: '無効な方向です。forward, back, left, right, up, downを使用してください'
                };
            }
            
            const commands: string[] = [];
            for (let i = 0; i < times; i++) {
                // エージェントの位置から指定方向の座標を攻撃
                commands.push(`execute @c ${targetCoords} run setblock ~ ~ ~ air destroy`);
            }
            
            const result = await this.executeBatch(commands, false);
            
            if (result.success) {
                return {
                    success: true,
                    message: `Agent attacked ${direction} ${times} time(s)`,
                    data: {
                        direction: direction,
                        times: times,
                        commandsExecuted: commands.length
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error with agent attack: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}