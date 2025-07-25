import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * Minecraftシステムツール
 * スコアボード、画面表示、システム機能に特化
 */
export class SystemTool extends BaseTool {
    readonly name = 'system';
    readonly description = 'System features: scoreboards, screen displays (titles, action bars), player UI, game management';
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description: 'System category to use',
                enum: ['scoreboard', 'screen']
            },
            action: {
                type: 'string',
                description: 'Action to perform within the category'
            },
            // Scoreboard parameters
            objective_id: {
                type: 'string',
                description: 'Scoreboard objective ID'
            },
            display_name: {
                type: 'string',
                description: 'Display name for objective'
            },
            player_name: {
                type: 'string',
                description: 'Target player name (optional, defaults to local player)'
            },
            score: {
                type: 'number',
                description: 'Score value'
            },
            display_slot: {
                type: 'string',
                description: 'Display slot for scoreboard',
                enum: ['sidebar', 'list', 'belowname']
            },
            sort_order: {
                type: 'string',
                description: 'Sort order for scoreboard',
                enum: ['ascending', 'descending']
            },
            // Screen display parameters
            title: {
                type: 'string',
                description: 'Title text'
            },
            subtitle: {
                type: 'string',
                description: 'Subtitle text'
            },
            message: {
                type: 'string',
                description: 'Action bar message'
            },
            fade_in: {
                type: 'number',
                description: 'Fade in duration in ticks (default: 10)',
                default: 10
            },
            stay: {
                type: 'number',
                description: 'Stay duration in ticks (default: 70)',
                default: 70
            },
            fade_out: {
                type: 'number',
                description: 'Fade out duration in ticks (default: 20)',
                default: 20
            }
        },
        required: ['category', 'action']
    };

    /**
     * システム機能を実行します
     * 
     * @param args - システム操作パラメータ
     * @param args.category - システムカテゴリ（scoreboard, screen）
     * @param args.action - 実行するアクション
     * @param args.objective_id - スコアボード目標ID
     * @param args.display_name - 表示名
     * @param args.player_name - 対象プレイヤー名
     * @param args.score - スコア値
     * @param args.display_slot - 表示スロット（sidebar, belowname等）
     * @param args.sort_order - ソート順（ascending, descending）
     * @param args.title - タイトルテキスト
     * @param args.subtitle - サブタイトルテキスト
     * @param args.message - メッセージテキスト
     * @returns ツール実行結果
     */
    async execute(args: {
        category: string;
        action: string;
        objective_id?: string;
        display_name?: string;
        player_name?: string;
        score?: number;
        display_slot?: string;
        sort_order?: string;
        title?: string;
        subtitle?: string;
        message?: string;
        fade_in?: number;
        stay?: number;
        fade_out?: number;
    }): Promise<ToolCallResult> {
        if (!this.world) {
            return { success: false, message: 'World not available for system operations.' };
        }

        try {
            const { category, action } = args;

            switch (category) {
                case 'scoreboard':
                    return await this.executeScoreboardOperation(action, args);
                case 'screen':
                    return await this.executeScreenOperation(action, args);
                default:
                    return { success: false, message: `Unknown category: ${category}. Use: scoreboard, screen` };
            }

        } catch (error) {
            return {
                success: false,
                message: `System operation error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private async executeScoreboardOperation(action: string, args: any): Promise<ToolCallResult> {
        const scoreboard = this.world!.scoreboard;
        let result: any;
        let message: string;

        switch (action) {
            case 'list_objectives':
                result = await scoreboard.getObjectives();
                message = 'Scoreboard objectives listed';
                break;

            case 'create_objective':
                if (!args.objective_id) return { success: false, message: 'objective_id required for create_objective' };
                result = await scoreboard.addObjective(args.objective_id, args.display_name);
                message = `Objective ${args.objective_id} created`;
                break;

            case 'remove_objective':
                if (!args.objective_id) return { success: false, message: 'objective_id required for remove_objective' };
                result = await scoreboard.removeObjective(args.objective_id);
                message = `Objective ${args.objective_id} removed`;
                break;

            case 'get_score':
                if (!args.objective_id) return { success: false, message: 'objective_id required for get_score' };
                const targetForGet = args.player_name || this.world!.localPlayer.name;
                result = await scoreboard.getScore(targetForGet, args.objective_id);
                message = `Score retrieved for ${targetForGet} in ${args.objective_id}: ${result}`;
                break;

            case 'set_score':
                if (!args.objective_id || args.score === undefined) {
                    return { success: false, message: 'objective_id and score required for set_score' };
                }
                const targetForSet = args.player_name || this.world!.localPlayer.name;
                result = await scoreboard.setScore(targetForSet, args.objective_id, args.score);
                message = `Score set to ${args.score} for ${targetForSet} in ${args.objective_id}`;
                break;

            case 'add_score':
                if (!args.objective_id || args.score === undefined) {
                    return { success: false, message: 'objective_id and score required for add_score' };
                }
                const targetForAdd = args.player_name || this.world!.localPlayer.name;
                result = await scoreboard.addScore(targetForAdd, args.objective_id, args.score);
                message = `Added ${args.score} to ${targetForAdd} in ${args.objective_id}`;
                break;

            case 'remove_score':
                if (!args.objective_id || args.score === undefined) {
                    return { success: false, message: 'objective_id and score required for remove_score' };
                }
                const targetForRemove = args.player_name || this.world!.localPlayer.name;
                result = await scoreboard.removeScore(targetForRemove, args.objective_id, args.score);
                message = `Removed ${args.score} from ${targetForRemove} in ${args.objective_id}`;
                break;

            case 'reset_score':
                const targetForReset = args.player_name || this.world!.localPlayer.name;
                await scoreboard.resetScore(targetForReset, args.objective_id);
                message = `Score reset for ${targetForReset}`;
                break;

            case 'set_display':
                if (!args.display_slot) return { success: false, message: 'display_slot required for set_display' };
                await scoreboard.setDisplay(args.display_slot as any, args.objective_id, args.sort_order as any);
                message = `Display set for ${args.display_slot}`;
                break;

            case 'get_all_scores':
                const targetForAll = args.player_name || this.world!.localPlayer.name;
                result = await scoreboard.getScores(targetForAll);
                message = `All scores retrieved for ${targetForAll}`;
                break;

            default:
                return { success: false, message: `Unknown scoreboard action: ${action}` };
        }

        return {
            success: true,
            message: message,
            data: { category: 'scoreboard', action, result, timestamp: Date.now() }
        };
    }

    private async executeScreenOperation(action: string, args: any): Promise<ToolCallResult> {
        // Get target player
        let player = this.world!.localPlayer;
        if (args.player_name) {
            const players = await this.world!.getPlayers();
            const targetPlayer = players.find(p => p.name === args.player_name);
            if (!targetPlayer) {
                return { success: false, message: `Player ${args.player_name} not found` };
            }
            player = targetPlayer;
        }

        const screen = player.onScreenDisplay;
        let message: string;
        let result: any;

        switch (action) {
            case 'show_title':
                if (!args.title) return { success: false, message: 'title required for show_title' };
                const titleOptions = {
                    subtitle: args.subtitle,
                    times: {
                        fadeIn: args.fade_in || 10,
                        stay: args.stay || 70,
                        fadeOut: args.fade_out || 20
                    }
                };
                await screen.setTitle(args.title, titleOptions);
                message = `Title displayed to ${player.name}: "${args.title}"`;
                if (args.subtitle) message += ` with subtitle: "${args.subtitle}"`;
                break;

            case 'update_subtitle':
                if (!args.subtitle) return { success: false, message: 'subtitle required for update_subtitle' };
                await screen.updateSubtitle(args.subtitle);
                message = `Subtitle updated for ${player.name}: "${args.subtitle}"`;
                break;

            case 'show_action_bar':
                if (!args.message) return { success: false, message: 'message required for show_action_bar' };
                await screen.setActionBar(args.message);
                message = `Action bar shown to ${player.name}: "${args.message}"`;
                break;

            case 'set_title_duration':
                if (args.fade_in === undefined || args.stay === undefined || args.fade_out === undefined) {
                    return { success: false, message: 'fade_in, stay, and fade_out required for set_title_duration' };
                }
                await screen.setTitleDuration({
                    fadeIn: args.fade_in,
                    stay: args.stay,
                    fadeOut: args.fade_out
                });
                message = `Title duration set for ${player.name}: fadeIn=${args.fade_in}, stay=${args.stay}, fadeOut=${args.fade_out}`;
                break;

            case 'clear_title':
                await screen.clearTitle();
                message = `Title cleared for ${player.name}`;
                break;

            case 'reset_title':
                await screen.resetTitle();
                message = `Title reset for ${player.name}`;
                break;

            case 'check_screen_valid':
                result = screen.isValid;
                message = `Screen display validity checked for ${player.name}: ${result}`;
                break;

            default:
                return { success: false, message: `Unknown screen action: ${action}` };
        }

        return {
            success: true,
            message: message,
            data: { category: 'screen', action, result, targetPlayer: player.name, timestamp: Date.now() }
        };
    }
}