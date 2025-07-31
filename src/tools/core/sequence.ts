import { BaseTool, SequenceStep } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * グローバルシーケンス実行インターフェース
 */
export interface GlobalSequenceStep extends SequenceStep {
    tool: string;  // 実行するツール名
}

/**
 * クロスツールシーケンス実行ツール
 * 複数のツールを混在させたシーケンスを実行可能
 */
export class SequenceTool extends BaseTool {
    readonly name = 'sequence';
    readonly description = 'Execute CROSS-TOOL SEQUENCES: Chain actions from multiple tools together with timing control. Perfect for complex automation like "teleport player → wait 2s → build cube → take screenshot → say message". Supports all tools: player(teleport/move/say), agent(move/turn), camera(shot/video), blocks(setblock/fill), world(time/weather), building(cube/sphere/line). Use wait_time for delays, on_error for handling failures.';
    
    private toolRegistry: Map<string, BaseTool> = new Map();
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            steps: {
                type: 'array',
                description: 'Array of sequence steps. Each step needs: "tool" (player/agent/camera/blocks/world/building), "type" (action like teleport/move/shot/setblock/build), and tool-specific params. Optional: "wait_time" (seconds to wait after), "on_error" (continue/stop/retry), "retry_count" (max retries). Example: [{tool:"player",type:"teleport",x:0,y:70,z:0,wait_time:2},{tool:"blocks",type:"setblock",x:0,y:70,z:0,block:"diamond_block"}]',
                items: {
                    type: 'object',
                    description: 'Individual cross-tool sequence step',
                    properties: {
                        tool: {
                            type: 'string',
                            description: 'Tool name: player, agent, camera, blocks, world, or any building tool (build_cube, build_sphere, etc.)'
                        },
                        type: {
                            type: 'string', 
                            description: 'Action type: depends on tool - player(teleport/move/say), agent(move/turn), camera(shot/video), blocks(setblock/fill), world(time/weather/gamemode), building(build)'
                        },
                        wait_time: {
                            type: 'number',
                            description: 'Seconds to wait after this step (default: 0)',
                            minimum: 0,
                            maximum: 60
                        },
                        on_error: {
                            type: 'string',
                            description: 'Error handling: continue (ignore errors), stop (halt sequence), retry (try again)',
                            enum: ['continue', 'stop', 'retry']
                        },
                        retry_count: {
                            type: 'number',
                            description: 'Max retry attempts when on_error=retry (default: 3)',
                            minimum: 1,
                            maximum: 10
                        }
                    },
                    required: ['tool', 'type']
                }
            },
            description: {
                type: 'string',
                description: 'Optional description of what this sequence does'
            }
        },
        required: ['steps']
    };

    /**
     * ツールレジストリの設定
     */
    public setToolRegistry(tools: Map<string, BaseTool>): void {
        this.toolRegistry = tools;
    }

    /**
     * クロスツールシーケンスを実行
     */
    async execute(args: {
        steps: GlobalSequenceStep[];
        description?: string;
    }): Promise<ToolCallResult> {
        const { steps, description } = args;
        
        if (!steps || !Array.isArray(steps) || steps.length === 0) {
            return this.createErrorResponse('steps array is required for sequence execution');
        }

        try {
            let totalDuration = 0;
            const results: string[] = [];
            const sequenceId = Date.now().toString(36);
            
            if (description) {
                results.push(`Sequence: ${description}`);
            }
            
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                // デバッグログは標準エラー出力に送信（MCPモードでは非表示）
                if (process.stdin.isTTY !== false) {
                    console.error(`[Sequence ${sequenceId}] Executing step ${i + 1}/${steps.length}: ${step.tool}.${step.type}`);
                }
                
                const stepResult = await this.executeGlobalSequenceStep(step, i);
                
                if (!stepResult.success) {
                    const errorAction = step.on_error || 'stop';
                    
                    switch (errorAction) {
                        case 'continue':
                            results.push(`Step ${i + 1} (${step.tool}.${step.type}): Failed but continuing - ${stepResult.message}`);
                            if (process.stdin.isTTY !== false) {
                                console.error(`[Sequence ${sequenceId}] Step ${i + 1} failed but continuing`);
                            }
                            break;
                        case 'retry':
                            const retryResult = await this.retryGlobalSequenceStep(step, i);
                            if (!retryResult.success) {
                                return this.createErrorResponse(`Step ${i + 1} (${step.tool}.${step.type}) failed after retries: ${retryResult.message}`);
                            }
                            results.push(`Step ${i + 1} (${step.tool}.${step.type}): Succeeded after retry - ${retryResult.message}`);
                            if (process.stdin.isTTY !== false) {
                                console.error(`[Sequence ${sequenceId}] Step ${i + 1} succeeded after retry`);
                            }
                            break;
                        case 'stop':
                        default:
                            return this.createErrorResponse(`Step ${i + 1} (${step.tool}.${step.type}) failed: ${stepResult.message}`);
                    }
                } else {
                    results.push(`Step ${i + 1} (${step.tool}.${step.type}): ${stepResult.message || 'Executed'}`);
                    if (process.stdin.isTTY !== false) {
                        console.error(`[Sequence ${sequenceId}] Step ${i + 1} completed successfully`);
                    }
                }
                
                // 待ち時間処理
                const waitTime = step.wait_time || 0;
                if (waitTime > 0 && i < steps.length - 1) {
                    if (process.stdin.isTTY !== false) {
                        console.error(`[Sequence ${sequenceId}] Waiting ${waitTime}s before next step`);
                    }
                    await this.delay(waitTime);
                    totalDuration += waitTime;
                }
            }
            
            if (process.stdin.isTTY !== false) {
                console.error(`[Sequence ${sequenceId}] Completed all ${steps.length} steps`);
            }
            
            return this.createSuccessResponse(
                `Cross-tool sequence completed: ${steps.length} steps executed over ${totalDuration.toFixed(1)}s\n` +
                results.join('\n')
            );
            
        } catch (error) {
            return this.createErrorResponse(`Cross-tool sequence execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * グローバルシーケンスステップの実行
     */
    private async executeGlobalSequenceStep(step: GlobalSequenceStep, index: number): Promise<ToolCallResult> {
        // wait ステップは特別処理
        if (step.type === 'wait') {
            const waitTime = step.wait_time || 1;
            await this.delay(waitTime);
            return this.createSuccessResponse(`Waited ${waitTime}s`);
        }

        // 指定されたツールを取得
        const tool = this.toolRegistry.get(step.tool);
        if (!tool) {
            return this.createErrorResponse(`Tool '${step.tool}' not found in registry`);
        }

        // ツール用の引数を準備 (tool フィールドを除外)
        const { tool: toolName, ...toolArgs } = step;
        const executeArgs = { action: step.type, ...toolArgs };

        try {
            // 指定されたツールでアクションを実行
            return await tool.execute(executeArgs);
        } catch (error) {
            return this.createErrorResponse(`Tool ${step.tool} execution error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 失敗したグローバルシーケンスステップをリトライ
     */
    private async retryGlobalSequenceStep(step: GlobalSequenceStep, index: number): Promise<ToolCallResult> {
        const maxRetries = step.retry_count || 3;
        
        for (let retry = 1; retry <= maxRetries; retry++) {
            if (process.stdin.isTTY !== false) {
                console.error(`Retrying global step ${index + 1} (${step.tool}.${step.type}), attempt ${retry}/${maxRetries}`);
            }
            
            // 少し待ってからリトライ
            await this.delay(0.5);
            
            const result = await this.executeGlobalSequenceStep(step, index);
            if (result.success) {
                return result;
            }
            
            if (retry === maxRetries) {
                return this.createErrorResponse(`Global step failed after ${maxRetries} retries: ${result.message}`);
            }
        }
        
        return this.createErrorResponse('Retry logic error');
    }
}