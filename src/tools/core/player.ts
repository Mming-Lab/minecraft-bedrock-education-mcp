import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';
import { GameMode, AbilityType } from 'socket-be';

/**
 * Player操作ツール
 * プレイヤー管理、権限、情報取得に特化
 */
export class PlayerTool extends BaseTool {
    readonly name = 'player';
    readonly description = 'Player management. Handles player information, abilities, game modes, inventory, and communication. Provides easy player queries, permission management, and item giving. AI-optimized for player administration and interaction.';
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Player operation to perform: get_info (returns player details like name, uniqueId, uuid, deviceId, xuid, isValid, isLoaded, isLocalPlayer), get_location (returns foot coordinates x,y,z and rotation in both Minecraft yaw -180°~+180° and compass bearing 0°~360° systems), send_message (sends chat message, requires: message), give_item (gives items to inventory, requires: item_id, optional: amount, can_destroy, can_place_on, keep_on_death), set_gamemode (changes game mode, optional: gamemode survival/creative/adventure/spectator, defaults to survival), add_levels (adds XP levels, requires: levels positive integer), get_abilities (returns abilities object with boolean values for mayfly/mute/worldbuilder), set_ability (modifies ability, requires: ability mayfly/mute/worldbuilder, ability_value boolean), get_tags (returns array of player tags), check_tag (checks specific tag, requires: tag, returns boolean), get_ping (returns network ping in milliseconds), list_all_players (returns array of online players with name, isLocalPlayer, isValid, isLoaded)',
                enum: [
                    'get_info', 'get_location', 'send_message', 'give_item', 'set_gamemode',
                    'add_levels', 'get_abilities', 'set_ability', 'get_tags', 'check_tag',
                    'get_ping', 'list_all_players'
                ]
            },
            player_name: {
                type: 'string',
                description: 'Target player name (optional, defaults to local player)'
            },
            message: {
                type: 'string',
                description: 'Message to send to player'
            },
            item_id: {
                type: 'string',
                description: 'Item ID to give (e.g., minecraft:diamond, minecraft:iron_sword)'
            },
            amount: {
                type: 'number',
                description: 'Item amount (1-64)',
                minimum: 1,
                maximum: 64,
                default: 1
            },
            gamemode: {
                type: 'string',
                description: 'Game mode to set',
                enum: ['survival', 'creative', 'adventure', 'spectator']
            },
            levels: {
                type: 'number',
                description: 'Experience levels to add',
                minimum: 1
            },
            ability: {
                type: 'string',
                description: 'Player ability to modify',
                enum: ['mayfly', 'mute', 'worldbuilder']
            },
            ability_value: {
                type: 'boolean',
                description: 'Enable or disable the ability'
            },
            tag: {
                type: 'string',
                description: 'Tag to check for'
            },
            can_destroy: {
                type: 'array',
                description: 'Blocks this item can destroy (optional)'
            },
            can_place_on: {
                type: 'array', 
                description: 'Blocks this item can be placed on (optional)'
            },
            keep_on_death: {
                type: 'boolean',
                description: 'Keep item on death (optional)',
                default: false
            }
        },
        required: ['action']
    };

    /**
     * プレイヤー操作を実行します
     * 
     * @param args - プレイヤー操作パラメータ
     * @param args.action - 実行するアクション（get_info, send_message, give_item等）
     * @param args.player_name - 対象プレイヤー名（省略時は接続中プレイヤー）
     * @param args.message - 送信メッセージ（send_message時）
     * @param args.item_id - アイテムID（give_item時）
     * @param args.amount - 数量（give_item時、デフォルト: 1）
     * @param args.gamemode - ゲームモード（creative, survival, adventure, spectator）
     * @param args.levels - 追加レベル数（add_levels時）
     * @param args.ability - 能力タイプ（fly, mayfly, instabuild等）
     * @param args.ability_value - 能力の有効/無効
     * @param args.tag - プレイヤータグ
     * @returns ツール実行結果
     */
    async execute(args: {
        action: string;
        player_name?: string;
        message?: string;
        item_id?: string;
        amount?: number;
        gamemode?: string;
        levels?: number;
        ability?: string;
        ability_value?: boolean;
        tag?: string;
        can_destroy?: string[];
        can_place_on?: string[];
        keep_on_death?: boolean;
    }): Promise<ToolCallResult> {
        if (!this.world) {
            return { success: false, message: 'World not available for player operations.' };
        }

        try {
            const { action } = args;
            let result: any;
            let message: string;

            // Get target player
            let player = this.world.localPlayer;
            if (args.player_name) {
                const players = await this.world.getPlayers();
                const targetPlayer = players.find(p => p.name === args.player_name);
                if (!targetPlayer) {
                    return { success: false, message: `Player ${args.player_name} not found` };
                }
                player = targetPlayer;
            }

            switch (action) {
                case 'get_info':
                    result = {
                        name: player.name,
                        rawName: player.rawName,
                        uniqueId: player.uniqueId,
                        uuid: player.uuid,
                        deviceId: player.deviceId,
                        xuid: player.xuid,
                        isValid: player.isValid,
                        isLoaded: player.isLoaded,
                        isLocalPlayer: player.isLocalPlayer
                    };
                    message = `Player info retrieved for ${player.name}`;
                    break;

                case 'get_location':
                    const headLocation = await player.getLocation();
                    const queryResult = await player.query();
                    // Minecraft yaw をコンパス座標系に変換
                    const compassBearing = this.minecraftYawToCompass(queryResult.yRot);
                    // 頭部座標から足元座標に変換（Y座標を-1.63調整）
                    result = {
                        x: headLocation.x,
                        y: Math.floor(headLocation.y - 1.63), // 足元の整数座標
                        z: headLocation.z,
                        rotation: {
                            minecraft_yaw: queryResult.yRot, // Minecraft座標系: 0°=南, -90°=東, +90°=西, ±180°=北
                            compass_bearing: compassBearing  // コンパス座標系: 0°=北, 90°=東, 180°=南, 270°=西
                        }
                    };
                    message = `Location and rotation retrieved for ${player.name} (converted from head position)`;
                    break;

                case 'send_message':
                    if (!args.message) return { success: false, message: 'Message required for send_message' };
                    await player.sendMessage(args.message);
                    message = `Message sent to ${player.name}: "${args.message}"`;
                    break;

                case 'give_item':
                    if (!args.item_id) return { success: false, message: 'item_id required for give_item' };
                    const giveOptions = {
                        data: 0,
                        canDestroy: args.can_destroy,
                        canPlaceOn: args.can_place_on,
                        keepOnDeath: args.keep_on_death || false
                    };
                    const giveAmount = args.amount || 1;
                    await player.giveItem(this.normalizeItemId(args.item_id), giveAmount, giveOptions);
                    message = `Gave ${giveAmount} ${args.item_id} to ${player.name}`;
                    break;

                case 'set_gamemode':
                    if (args.gamemode) {
                        const gameMode = this.normalizeGameMode(args.gamemode);
                        await player.setGameMode(gameMode);
                        message = `Game mode set to ${args.gamemode} for ${player.name}`;
                    } else {
                        await player.setGameMode();
                        message = `Game mode reset to default for ${player.name}`;
                    }
                    break;

                case 'add_levels':
                    if (!args.levels) return { success: false, message: 'levels required for add_levels' };
                    await player.addLevel(args.levels);
                    message = `Added ${args.levels} levels to ${player.name}`;
                    break;

                case 'get_abilities':
                    result = await player.getAbilities();
                    message = `Abilities retrieved for ${player.name}`;
                    break;

                case 'set_ability':
                    if (!args.ability || args.ability_value === undefined) {
                        return { success: false, message: 'ability and ability_value required for set_ability' };
                    }
                    await player.updateAbility(args.ability as AbilityType, args.ability_value);
                    message = `Ability ${args.ability} set to ${args.ability_value} for ${player.name}`;
                    break;

                case 'get_tags':
                    result = await player.getTags();
                    message = `Tags retrieved for ${player.name}`;
                    break;

                case 'check_tag':
                    if (!args.tag) return { success: false, message: 'tag required for check_tag' };
                    result = await player.hasTag(args.tag);
                    message = `Tag ${args.tag} ${result ? 'found' : 'not found'} for ${player.name}`;
                    break;

                case 'get_ping':
                    result = await player.getPing();
                    message = `Ping retrieved for ${player.name}: ${result}ms`;
                    break;

                case 'list_all_players':
                    const allPlayers = await this.world.getPlayers();
                    result = allPlayers.map(p => ({
                        name: p.name,
                        isLocalPlayer: p.isLocalPlayer,
                        isValid: p.isValid,
                        isLoaded: p.isLoaded
                    }));
                    message = `Found ${allPlayers.length} players online`;
                    break;

                default:
                    return { success: false, message: `Unknown action: ${action}` };
            }

            return {
                success: true,
                message: message,
                data: { action, result, targetPlayer: player.name, timestamp: Date.now() }
            };

        } catch (error) {
            return {
                success: false,
                message: `Player operation error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private normalizeItemId(itemId: string): string {
        if (!itemId.includes(':')) {
            return `minecraft:${itemId}`;
        }
        return itemId.toLowerCase();
    }

    private normalizeGameMode(gameMode: string): GameMode {
        switch (gameMode.toLowerCase()) {
            case 'survival':
                return GameMode.survival;
            case 'creative':
                return GameMode.creative;
            case 'adventure':
                return GameMode.adventure;
            case 'spectator':
                return GameMode.spectator;
            default:
                return GameMode.survival;
        }
    }

    /**
     * MinecraftのYaw度数をコンパス座標系（北基準、時計回り）に変換
     * Minecraft: 0°=南, -90°=東, +90°=西, ±180°=北
     * コンパス: 0°=北, 90°=東, 180°=南, 270°=西
     */
    private minecraftYawToCompass(minecraftYaw: number): number {
        // Minecraft yaw を コンパス bearing に変換
        // Minecraft: 0°=南, -90°=東, +90°=西, ±180°=北
        // コンパス: 0°=北, 90°=東, 180°=南, 270°=西
        let compass = (-minecraftYaw + 180 + 360) % 360;
        
        return Math.round(compass * 100) / 100; // 小数点2桁まで
    }
}