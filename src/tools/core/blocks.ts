import { BaseTool, SequenceStep } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';
import { SetBlockMode, FillBlocksMode } from 'socket-be';

/**
 * Block操作高レベルツール
 * ブロック設置・塗りつぶし・情報取得に特化
 */
export class BlocksTool extends BaseTool {
    readonly name = 'blocks';
    readonly description = 'Block operations: placement, area filling, terrain queries, single blocks, large areas, surface detection';
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Block operation to perform',
                enum: [
                    'set_block', 'fill_area', 'get_top_solid_block', 'query_block_data',
                    'query_item_data', 'query_mob_data', 'sequence'
                ]
            },
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
            z: { type: 'number', description: 'Z coordinate' },
            x2: { type: 'number', description: 'Second X coordinate for area operations' },
            y2: { type: 'number', description: 'Second Y coordinate for area operations' },
            z2: { type: 'number', description: 'Second Z coordinate for area operations' },
            block_id: {
                type: 'string',
                description: 'Block ID (e.g., minecraft:stone, minecraft:dirt, minecraft:air)'
            },
            mode: {
                type: 'string',
                description: 'Block placement/fill mode',
                enum: ['replace', 'keep', 'destroy', 'hollow', 'outline']
            },
            steps: {
                type: 'array',
                description: 'Array of block actions for sequence. Each step should have "type" field and relevant parameters.'
            }
        },
        required: ['action']
    };

    /**
     * ブロック操作を実行します
     * 
     * @param args - ブロック操作パラメータ
     * @param args.action - 実行するアクション（set_block, fill_area, get_top_solid_block等）
     * @param args.x - X座標
     * @param args.y - Y座標
     * @param args.z - Z座標
     * @param args.x2 - 終了X座標（fill_area時）
     * @param args.y2 - 終了Y座標（fill_area時）
     * @param args.z2 - 終了Z座標（fill_area時）
     * @param args.block_id - ブロックID（set_block, fill_area時）
     * @param args.mode - 設置モード（replace, hollow, keep等）
     * @returns ツール実行結果
     */
    async execute(args: {
        action: string;
        x?: number;
        y?: number;
        z?: number;
        x2?: number;
        y2?: number;
        z2?: number;
        block_id?: string;
        mode?: string;
        steps?: SequenceStep[];
    }): Promise<ToolCallResult> {
        if (!this.world) {
            return { success: false, message: 'World not available. Ensure Minecraft is connected.' };
        }

        try {
            const { action } = args;
            let result: any;
            let message: string;

            switch (action) {
                case 'set_block':
                    if (args.x === undefined || args.y === undefined || args.z === undefined || !args.block_id) {
                        return { success: false, message: 'Coordinates (x,y,z) and block_id required for set_block' };
                    }
                    
                    if (!this.validateCoordinates(args.x, args.y, args.z)) {
                        return { success: false, message: 'Invalid coordinates. Y must be between -64 and 320.' };
                    }

                    const setOptions = args.mode && args.mode !== 'replace' ? 
                        { mode: args.mode as SetBlockMode } : undefined;
                    
                    await this.world.setBlock(
                        { x: args.x, y: args.y, z: args.z }, 
                        this.normalizeBlockId(args.block_id), 
                        setOptions
                    );
                    
                    message = `Block ${args.block_id} set at (${args.x}, ${args.y}, ${args.z})`;
                    if (args.mode && args.mode !== 'replace') {
                        message += ` with mode: ${args.mode}`;
                    }
                    break;

                case 'fill_area':
                    if (args.x === undefined || args.y === undefined || args.z === undefined ||
                        args.x2 === undefined || args.y2 === undefined || args.z2 === undefined || 
                        !args.block_id) {
                        return { success: false, message: 'All coordinates (x,y,z,x2,y2,z2) and block_id required for fill_area' };
                    }

                    if (!this.validateCoordinates(args.x, args.y, args.z) || 
                        !this.validateCoordinates(args.x2, args.y2, args.z2)) {
                        return { success: false, message: 'Invalid coordinates. Y values must be between -64 and 320.' };
                    }

                    // Calculate volume for safety check
                    const volume = Math.abs(args.x2 - args.x + 1) * 
                                 Math.abs(args.y2 - args.y + 1) * 
                                 Math.abs(args.z2 - args.z + 1);
                    
                    if (volume > 32768) {
                        return { success: false, message: `Area too large (${volume} blocks). Maximum is 32768 blocks.` };
                    }

                    let fillOptions: any = undefined;
                    if (args.mode && args.mode !== 'replace') {
                        fillOptions = { mode: args.mode as FillBlocksMode };
                    }

                    result = await this.world.fillBlocks(
                        { x: args.x, y: args.y, z: args.z },
                        { x: args.x2, y: args.y2, z: args.z2 },
                        this.normalizeBlockId(args.block_id),
                        fillOptions
                    );

                    message = `Filled ${result} blocks with ${args.block_id} from (${args.x},${args.y},${args.z}) to (${args.x2},${args.y2},${args.z2})`;
                    if (args.mode && args.mode !== 'replace') {
                        message += ` with mode: ${args.mode}`;
                    }
                    break;

                case 'get_top_solid_block':
                    const location = (args.x !== undefined && args.z !== undefined) ? 
                        { x: args.x, y: args.y || 320, z: args.z } : undefined;
                    
                    result = await this.world.getTopSolidBlock(location);
                    
                    if (location) {
                        message = `Top solid block found at (${args.x}, ${result?.y || 'none'}, ${args.z})`;
                    } else {
                        message = 'Top solid block found at current location';
                    }
                    break;

                case 'query_block_data':
                    result = await this.world.queryData('block');
                    message = 'Block data retrieved';
                    break;

                case 'query_item_data':
                    result = await this.world.queryData('item');
                    message = 'Item data retrieved';
                    break;

                case 'query_mob_data':
                    result = await this.world.queryData('mob');
                    message = 'Mob data retrieved';
                    break;

                case 'sequence':
                    if (!args.steps) {
                        return this.createErrorResponse('steps array is required for sequence action');
                    }
                    return await this.executeSequence(args.steps as SequenceStep[]);

                default:
                    return { success: false, message: `Unknown action: ${action}` };
            }

            return {
                success: true,
                message: message,
                data: { action, result, volume: result, timestamp: Date.now() }
            };

        } catch (error) {
            return {
                success: false,
                message: `Block operation error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * ブロック専用のシーケンスステップ実行
     * 
     * @param step - 実行するステップ
     * @param index - ステップのインデックス
     * @returns ステップ実行結果
     * 
     * @protected
     * @override
     */
    protected async executeSequenceStep(step: SequenceStep, index: number): Promise<ToolCallResult> {
        // wait ステップは基底クラスで処理される
        if (step.type === 'wait') {
            return await super.executeSequenceStep(step, index);
        }

        // ブロック特有のステップを実行
        const blocksArgs = { action: step.type, ...step };
        return await this.execute(blocksArgs);
    }
}