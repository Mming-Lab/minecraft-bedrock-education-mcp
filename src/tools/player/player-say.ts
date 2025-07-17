import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * プレイヤーからメッセージを送信するツール
 */
export class PlayerSayTool extends BaseTool {
    readonly name = 'player_say';
    readonly description = 'Send a message as the player to all players in the world';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The message to send'
            },
            target: {
                type: 'string',
                description: 'Target player for private message (optional)',
                default: 'all'
            }
        },
        required: ['message']
    };

    async execute(args: {
        message: string;
        target?: string;
    }): Promise<ToolCallResult> {
        try {
            const { message, target = 'all' } = args;
            
            let command: string;
            if (target === 'all') {
                // 全プレイヤーへのパブリックメッセージ
                command = `say ${message}`;
            } else {
                // 特定のプレイヤーへのプライベートメッセージ
                command = `tell ${target} ${message}`;
            }

            const result = await this.executeCommand(command);
            
            if (result.success) {
                return {
                    success: true,
                    message: `Message sent${target !== 'all' ? ` to ${target}` : ' to all players'}: "${message}"`,
                    data: {
                        message: message,
                        target: target,
                        type: target === 'all' ? 'public' : 'private'
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error sending message: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}