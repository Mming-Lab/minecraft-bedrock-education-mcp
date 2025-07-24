import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * プレイヤーからメッセージを送信するツール
 */
export class PlayerSayTool extends BaseTool {
    readonly name = 'player_say';
    readonly description = 'Send chat messages as the player to communicate with other players or leave notes. Perfect for multiplayer coordination, status updates, or documenting activities. Supports both public messages visible to all players and private messages to specific players. Messages appear in chat with the player\'s name, making it ideal for roleplay or collaborative building.'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'The text message to send in chat. Can be any text - coordinates, instructions, greetings, or status updates. Example: "Building complete at X=100 Z=200" or "Hello everyone!"'
            },
            target: {
                type: 'string',
                description: 'Target recipient for the message. Use "all" for public message visible to everyone, or specify a player name (e.g., "Steve") for private message. Private messages only the specified player can see.',
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