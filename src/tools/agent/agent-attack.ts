import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * エージェントが攻撃するツール
 */
export class AgentAttackTool extends BaseTool {
    readonly name = 'agent_attack';
    readonly description = '⚠️ BEDROCK LIMITATION: Agent attack functionality is limited in Bedrock Edition. This tool simulates attacks by breaking blocks in the specified direction using setblock commands. Perfect for automated mining, clearing obstacles, or resource gathering. Works by destroying blocks adjacent to the agent position. Note: This is a workaround implementation since native agent attack commands are not fully supported in Bedrock Edition.'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            direction: {
                type: 'string',
                description: 'Direction to attack/break blocks relative to agent position. "forward" breaks the block the agent is facing, "up" breaks above, etc. Perfect for clearing paths or mining operations.',
                enum: ['forward', 'back', 'left', 'right', 'up', 'down']
            },
            times: {
                type: 'number',
                description: 'Number of attack attempts (blocks to break) in the specified direction. Example: times=3 breaks 3 blocks in sequence. Useful for creating tunnels or clearings.',
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