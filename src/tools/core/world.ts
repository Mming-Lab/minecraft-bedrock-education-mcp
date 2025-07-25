import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';
import { WeatherType } from 'socket-be';

/**
 * World管理ツール
 * 時間、天気、ワールド情報の制御に特化
 */
export class WorldTool extends BaseTool {
    readonly name = 'world';
    readonly description = 'World management. Controls time, weather, world information, and environment settings. Provides simple commands for day/night cycles, weather changes, world queries, and connection management. AI-optimized for easy world state manipulation.';
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'World management action to perform',
                enum: [
                    'set_time', 'get_time', 'get_day', 'set_weather', 'get_weather',
                    'get_players', 'get_world_info', 'send_message', 'run_command',
                    'get_connection_info'
                ]
            },
            time: {
                type: 'number',
                description: 'Time in ticks (0-24000, where 0=dawn, 6000=noon, 12000=dusk, 18000=midnight)',
                minimum: 0,
                maximum: 24000
            },
            weather: {
                type: 'string',
                description: 'Weather type to set',
                enum: ['clear', 'rain', 'thunder']
            },
            duration: {
                type: 'number',
                description: 'Weather duration in ticks (optional)',
                minimum: 0
            },
            message: {
                type: 'string',
                description: 'Message to send to all players'
            },
            target: {
                type: 'string',
                description: 'Target player for message (optional, defaults to all players)'
            },
            command: {
                type: 'string',
                description: 'Minecraft command to execute'
            }
        },
        required: ['action']
    };

    /**
     * ワールド管理操作を実行します
     * 
     * @param args - ワールド操作パラメータ
     * @param args.action - 実行するアクション（set_time, set_weather, get_info等）
     * @param args.time - 時刻設定（0-23999、0=朝6時、12000=夜6時）
     * @param args.weather - 天気タイプ（clear, rain, thunder）
     * @param args.duration - 天気継続時間（秒）
     * @param args.message - ブロードキャストメッセージ
     * @param args.target - メッセージ送信対象（省略時は全プレイヤー）
     * @param args.command - 実行するMinecraftコマンド
     * @returns ツール実行結果
     */
    async execute(args: {
        action: string;
        time?: number;
        weather?: string;
        duration?: number;
        message?: string;
        target?: string;
        command?: string;
    }): Promise<ToolCallResult> {
        if (!this.world) {
            return { success: false, message: 'World not available. Ensure Minecraft is connected.' };
        }

        try {
            const { action } = args;
            let result: any;
            let message: string;

            switch (action) {
                case 'set_time':
                    if (args.time === undefined) return { success: false, message: 'Time required for set_time' };
                    await this.world.setTimeOfDay(args.time);
                    const timeDesc = this.getTimeDescription(args.time);
                    message = `Time set to ${args.time} ticks (${timeDesc})`;
                    break;

                case 'get_time':
                    const currentTime = await this.world.getTimeOfDay();
                    const currentDay = await this.world.getDay();
                    const currentTick = await this.world.getCurrentTick();
                    result = { 
                        timeOfDay: currentTime, 
                        day: currentDay, 
                        totalTicks: currentTick,
                        description: this.getTimeDescription(currentTime)
                    };
                    message = `Current time: ${currentTime} ticks (${this.getTimeDescription(currentTime)}) on day ${currentDay}`;
                    break;

                case 'get_day':
                    result = await this.world.getDay();
                    message = `Current day: ${result}`;
                    break;

                case 'set_weather':
                    if (!args.weather) return { success: false, message: 'Weather required for set_weather' };
                    const weatherType = this.normalizeWeatherType(args.weather);
                    await this.world.setWeather(weatherType, args.duration);
                    message = args.duration ? 
                        `Weather set to ${args.weather} for ${args.duration} ticks` :
                        `Weather set to ${args.weather}`;
                    break;

                case 'get_weather':
                    result = await this.world.getWeather();
                    message = `Current weather: ${result}`;
                    break;

                case 'get_players':
                    const players = await this.world.getPlayers();
                    const playerInfo = players.map(p => ({ name: p.name, isLocal: p.isLocalPlayer }));
                    result = playerInfo;
                    message = `Found ${players.length} players online`;
                    break;

                case 'get_world_info':
                    result = {
                        name: this.world.name,
                        connectedAt: this.world.connectedAt,
                        averagePing: this.world.averagePing,
                        maxPlayers: this.world.maxPlayers,
                        isValid: this.world.isValid
                    };
                    message = `World info retrieved: ${this.world.name}`;
                    break;

                case 'send_message':
                    if (!args.message) return { success: false, message: 'Message required for send_message' };
                    await this.world.sendMessage(args.message, args.target);
                    message = args.target ? 
                        `Message sent to ${args.target}: "${args.message}"` :
                        `Message sent to all players: "${args.message}"`;
                    break;

                case 'run_command':
                    if (!args.command) return { success: false, message: 'Command required for run_command' };
                    result = await this.world.runCommand(args.command);
                    message = `Command executed: ${args.command}`;
                    break;

                case 'get_connection_info':
                    result = {
                        averagePing: this.world.averagePing,
                        connectedAt: this.world.connectedAt,
                        maxPlayers: this.world.maxPlayers,
                        isValid: this.world.isValid
                    };
                    message = 'Connection info retrieved';
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
                message: `World management error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private getTimeDescription(ticks: number): string {
        if (ticks >= 0 && ticks < 1000) return 'Dawn';
        if (ticks >= 1000 && ticks < 5000) return 'Morning';
        if (ticks >= 5000 && ticks < 7000) return 'Noon';
        if (ticks >= 7000 && ticks < 11000) return 'Afternoon';
        if (ticks >= 11000 && ticks < 13000) return 'Dusk';
        if (ticks >= 13000 && ticks < 17000) return 'Night';
        if (ticks >= 17000 && ticks < 19000) return 'Midnight';
        return 'Late Night';
    }

    private normalizeWeatherType(weather: string): WeatherType {
        switch (weather.toLowerCase()) {
            case 'clear':
                return WeatherType.Clear;
            case 'rain':
                return WeatherType.Rain;
            case 'thunder':
                return WeatherType.Thunder;
            default:
                return WeatherType.Clear;
        }
    }
}