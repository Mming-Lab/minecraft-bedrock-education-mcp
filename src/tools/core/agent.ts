import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';
import { AgentDirection } from 'socket-be';

/**
 * Socket-BE Agent高レベル制御ツール
 * AIフレンドリーな設計で複雑なエージェント操作を簡単に実行
 */
export class AgentTool extends BaseTool {
    readonly name = 'agent';
    readonly description = 'High-level agent control using Socket-BE APIs. Provides intuitive agent operations including movement, building, mining, inventory management, and exploration. Optimized for AI with clear parameters and predictable behavior. Perfect for automated construction, resource gathering, and complex agent-based tasks.';
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Agent action to perform',
                enum: [
                    'move', 'turn', 'teleport', 'attack', 'mine_block', 'place_block', 
                    'inspect_block', 'detect_block', 'get_position', 'collect_item',
                    'drop_item', 'drop_all', 'get_inventory', 'set_item_in_slot'
                ]
            },
            direction: {
                type: 'string',
                description: 'Direction for movement/rotation/block operations',
                enum: ['forward', 'back', 'left', 'right', 'up', 'down']
            },
            distance: {
                type: 'number',
                description: 'Number of blocks to move (1-10)',
                minimum: 1,
                maximum: 10,
                default: 1
            },
            x: { type: 'number', description: 'X coordinate for teleportation' },
            y: { type: 'number', description: 'Y coordinate for teleportation' },
            z: { type: 'number', description: 'Z coordinate for teleportation' },
            slot: {
                type: 'number',
                description: 'Inventory slot (1-16)',
                minimum: 1,
                maximum: 16
            },
            item_id: {
                type: 'string',
                description: 'Item ID (e.g., minecraft:stone, minecraft:dirt)'
            },
            amount: {
                type: 'number',
                description: 'Item amount (1-64)',
                minimum: 1,
                maximum: 64,
                default: 1
            },
            data: {
                type: 'number',
                description: 'Item data/aux value',
                default: 0
            }
        },
        required: ['action']
    };

    /**
     * エージェントアクションを実行します
     * 
     * @param args - エージェント操作パラメータ
     * @param args.action - 実行するアクション（move, turn, teleport, attack等）
     * @param args.direction - 移動・回転方向（north, south, east, west, up, down）
     * @param args.distance - 移動距離（デフォルト: 1）
     * @param args.x - X座標（teleport時に使用）
     * @param args.y - Y座標（teleport時に使用）
     * @param args.z - Z座標（teleport時に使用）
     * @param args.slot - インベントリスロット番号（0-35）
     * @param args.item_id - アイテムID（Minecraft標準形式）
     * @returns ツール実行結果
     */
    async execute(args: {
        action: string;
        direction?: string;
        distance?: number;
        x?: number;
        y?: number;
        z?: number;
        slot?: number;
        item_id?: string;
        amount?: number;
        data?: number;
    }): Promise<ToolCallResult> {
        if (!this.agent) {
            return { success: false, message: 'Agent not available. Ensure Minecraft is connected and agent is spawned.' };
        }

        try {
            const { action } = args;
            let result: any;
            let message: string;

            switch (action) {
                case 'move':
                    if (!args.direction) return { success: false, message: 'Direction required for move' };
                    const distance = args.distance || 1;
                    for (let i = 0; i < distance; i++) {
                        await this.agent.move(args.direction as AgentDirection);
                    }
                    message = distance === 1 ? 
                        `Agent moved ${args.direction}` : 
                        `Agent moved ${distance} blocks ${args.direction}`;
                    break;

                case 'turn':
                    if (!args.direction || !['left', 'right'].includes(args.direction)) {
                        return { success: false, message: 'Direction must be "left" or "right" for turn' };
                    }
                    await this.agent.turn(args.direction as AgentDirection.Left | AgentDirection.Right);
                    message = `Agent turned ${args.direction}`;
                    break;

                case 'teleport':
                    if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
                        await this.agent.teleport({ x: args.x, y: args.y, z: args.z });
                        message = `Agent teleported to (${args.x}, ${args.y}, ${args.z})`;
                        result = { x: args.x, y: args.y, z: args.z };
                    } else {
                        await this.agent.teleport();
                        message = 'Agent teleported to player location';
                    }
                    break;

                case 'attack':
                    if (!args.direction) return { success: false, message: 'Direction required for attack' };
                    await this.agent.attack(args.direction as AgentDirection);
                    message = `Agent attacked ${args.direction}`;
                    break;

                case 'mine_block':
                    if (!args.direction) return { success: false, message: 'Direction required for mine_block' };
                    await this.agent.destroyBlock(args.direction as AgentDirection);
                    message = `Agent mined block ${args.direction}`;
                    break;

                case 'place_block':
                    if (!args.direction || !args.slot) return { success: false, message: 'Direction and slot required for place_block' };
                    await this.agent.placeBlock(args.direction as AgentDirection, args.slot);
                    message = `Agent placed block from slot ${args.slot} ${args.direction}`;
                    break;

                case 'inspect_block':
                    if (!args.direction) return { success: false, message: 'Direction required for inspect_block' };
                    result = await this.agent.inspect(args.direction as AgentDirection);
                    message = `Agent inspected block ${args.direction}`;
                    break;

                case 'detect_block':
                    if (!args.direction) return { success: false, message: 'Direction required for detect_block' };
                    result = await this.agent.detect(args.direction as AgentDirection);
                    message = `Agent detected block ${args.direction}`;
                    break;

                case 'get_position':
                    result = await this.agent.getLocation();
                    message = 'Agent position retrieved';
                    break;

                case 'collect_item':
                    if (!args.item_id) return { success: false, message: 'item_id required for collect_item' };
                    await this.agent.collect(args.item_id);
                    message = `Agent collected ${args.item_id}`;
                    break;

                case 'drop_item':
                    if (!args.direction || !args.slot) return { success: false, message: 'Direction and slot required for drop_item' };
                    const dropAmount = args.amount || 1;
                    await this.agent.dropItem(args.direction as AgentDirection, args.slot, dropAmount);
                    message = `Agent dropped ${dropAmount} items from slot ${args.slot} ${args.direction}`;
                    break;

                case 'drop_all':
                    if (!args.direction) return { success: false, message: 'Direction required for drop_all' };
                    await this.agent.dropAllItems(args.direction as AgentDirection);
                    message = `Agent dropped all items ${args.direction}`;
                    break;

                case 'get_inventory':
                    if (!args.slot) return { success: false, message: 'Slot required for get_inventory' };
                    const itemDetail = await this.agent.getItemDetail(args.slot);
                    const itemCount = await this.agent.getItemCount(args.slot);
                    const itemSpace = await this.agent.getItemSpace(args.slot);
                    result = { detail: itemDetail, count: itemCount, space: itemSpace };
                    message = `Inventory info for slot ${args.slot} retrieved`;
                    break;

                case 'set_item_in_slot':
                    if (!args.slot || !args.item_id) return { success: false, message: 'Slot and item_id required for set_item_in_slot' };
                    const setAmount = args.amount || 1;
                    const setData = args.data || 0;
                    await this.agent.setItem(args.slot, args.item_id, setAmount, setData);
                    message = `Set ${setAmount} ${args.item_id} in slot ${args.slot}`;
                    break;

                default:
                    return { success: false, message: `Unknown action: ${action}` };
            }

            return {
                success: true,
                message: message,
                data: { action, result, timestamp: Date.now() }
            };

        } catch (error) {
            return {
                success: false,
                message: `Agent operation error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}