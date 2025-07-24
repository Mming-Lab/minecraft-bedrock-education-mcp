import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * エージェントのブロック操作ツール（設置・破壊・耕す）
 */
export class AgentBlockActionTool extends BaseTool {
    readonly name = 'agent_block_action';
    readonly description = '⚠️ BEDROCK LIMITATION: Agent block manipulation commands are limited in Bedrock Edition. This tool simulates agent block actions using setblock commands executed at positions relative to the agent. Perfect for automated building, farming, or terrain modification. Supports placing blocks, destroying blocks, and tilling soil for farming. Note: This uses workaround implementation since native agent block commands are not fully supported in Bedrock Edition.'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Block operation type: "place" sets a block, "destroy" removes a block (with drops), "till" converts dirt/grass to farmland for crops',
                enum: ['place', 'destroy', 'till']
            },
            direction: {
                type: 'string',
                description: 'Direction relative to agent position where the action occurs. "forward" affects the block in front of the agent, "down" affects the block below, etc. Essential for precise block placement.',
                enum: ['forward', 'back', 'left', 'right', 'up', 'down']
            },
            block: {
                type: 'string',
                description: 'Block type to place when action=place. Use Minecraft block IDs like "stone", "dirt", "oak_planks", or full IDs like "minecraft:cobblestone". Example: "wool" places white wool block.',
                default: 'minecraft:stone'
            }
        },
        required: ['action', 'direction']
    };

    async execute(args: {
        action: 'place' | 'destroy' | 'till';
        direction: string;
        block?: string;
    }): Promise<ToolCallResult> {
        try {
            const { action, direction, block = 'minecraft:stone' } = args;
            
            // 方向に基づいて対象座標を決定
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
            
            let command: string;
            
            switch (action) {
                case 'place':
                    // ブロックIDの正規化
                    let blockId = block;
                    if (!blockId.includes(':')) {
                        blockId = `minecraft:${blockId}`;
                    }
                    command = `execute @c ${targetCoords} run setblock ~ ~ ~ ${blockId}`;
                    break;
                    
                case 'destroy':
                    command = `execute @c ${targetCoords} run setblock ~ ~ ~ air destroy`;
                    break;
                    
                case 'till':
                    // 土を耕す（土系ブロックを耕地に変換）
                    command = `execute @c ${targetCoords} run setblock ~ ~ ~ minecraft:farmland`;
                    break;
                    
                default:
                    return {
                        success: false,
                        message: 'Invalid action. Use: place, destroy, till'
                    };
            }
            
            const result = await this.executeCommand(command);
            
            if (result.success) {
                let message: string;
                switch (action) {
                    case 'place':
                        message = `エージェントが${direction}に${block}を設置しました`;
                        break;
                    case 'destroy':
                        message = `エージェントが${direction}のブロックを破壊しました`;
                        break;
                    case 'till':
                        message = `エージェントが${direction}の土を耕しました`;
                        break;
                }
                
                return {
                    success: true,
                    message: message,
                    data: {
                        action: action,
                        direction: direction,
                        ...(action === 'place' && { block: block })
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error with agent block action: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}