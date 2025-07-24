import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ワールドの時間・天候制御ツール
 */
export class WorldTimeWeatherTool extends BaseTool {
    readonly name = 'world_time_weather';
    readonly description = 'Control the world\'s time of day and weather conditions for atmosphere, gameplay, or cinematic purposes. Perfect for setting scenes, optimizing visibility, creating dramatic effects, or syncing with real activities. Time controls day/night cycle (0=sunrise, 6000=noon, 12000=sunset, 18000=midnight). Weather affects visibility, ambiance, and gameplay mechanics. Essential for world management and environmental storytelling.'
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: 'What to control: "time" changes day/night cycle only, "weather" changes weather only, "both" changes time and weather simultaneously',
                enum: ['time', 'weather', 'both']
            },
            time: {
                type: 'string',
                description: 'Preset time periods: "day"=morning (1000), "noon"=midday (6000), "sunset"=evening (12000), "night"=dark (13000), "midnight"=deepest night (18000), "sunrise"=dawn (23000). Perfect for specific lighting conditions.',
                enum: ['day', 'night', 'noon', 'midnight', 'sunrise', 'sunset']
            },
            timeValue: {
                type: 'number',
                description: 'Precise time in game ticks (0-24000). 0=sunrise, 6000=noon, 12000=sunset, 18000=midnight. One Minecraft day = 24000 ticks = 20 real minutes. Example: 15000 for late night.',
                minimum: 0,
                maximum: 24000
            },
            weather: {
                type: 'string',
                description: 'Weather conditions: "clear" removes all weather, "rain" creates rainfall (reduces visibility, extinguishes fire), "thunder" adds lightning and heavy rain (dangerous, dramatic)',
                enum: ['clear', 'rain', 'thunder']
            },
            duration: {
                type: 'number',
                description: 'How long the weather lasts in seconds. Example: 300 for 5 minutes of rain, 1800 for 30 minutes of clear weather. Longer durations provide stable conditions for building or events.',
                minimum: 1,
                maximum: 1000000,
                default: 600
            }
        },
        required: ['type']
    };

    async execute(args: {
        type: 'time' | 'weather' | 'both';
        time?: string;
        timeValue?: number;
        weather?: string;
        duration?: number;
    }): Promise<ToolCallResult> {
        try {
            const { type, time, timeValue, weather, duration = 600 } = args;
            
            const commands: string[] = [];
            const results: any = {};
            
            // 時間設定
            if (type === 'time' || type === 'both') {
                if (timeValue !== undefined) {
                    // 数値で時間指定
                    commands.push(`time set ${timeValue}`);
                    results.time = { value: timeValue, type: 'numeric' };
                } else if (time) {
                    // 文字列で時間指定
                    const timeMap: { [key: string]: number } = {
                        'day': 1000,
                        'noon': 6000,
                        'sunset': 12000,
                        'night': 13000,
                        'midnight': 18000,
                        'sunrise': 23000
                    };
                    
                    const timeVal = timeMap[time];
                    if (timeVal !== undefined) {
                        commands.push(`time set ${timeVal}`);
                        results.time = { value: timeVal, type: 'preset', preset: time };
                    } else {
                        return {
                            success: false,
                            message: 'Invalid time preset. Use: day, night, noon, midnight, sunrise, sunset'
                        };
                    }
                } else {
                    return {
                        success: false,
                        message: 'Time setting requires either "time" or "timeValue" parameter'
                    };
                }
            }
            
            // 天候設定
            if (type === 'weather' || type === 'both') {
                if (!weather) {
                    return {
                        success: false,
                        message: 'Weather setting requires "weather" parameter'
                    };
                }
                
                const validWeathers = ['clear', 'rain', 'thunder'];
                if (!validWeathers.includes(weather)) {
                    return {
                        success: false,
                        message: 'Invalid weather type. Use: clear, rain, thunder'
                    };
                }
                
                commands.push(`weather ${weather} ${duration}`);
                results.weather = { type: weather, duration: duration };
            }
            
            if (commands.length === 0) {
                return {
                    success: false,
                    message: 'No commands to execute'
                };
            }
            
            const result = await this.executeBatch(commands, true);
            
            if (result.success) {
                let message = 'World settings updated:';
                if (results.time) {
                    message += ` Time set to ${results.time.preset || results.time.value}`;
                }
                if (results.weather) {
                    message += ` Weather set to ${results.weather.type} for ${results.weather.duration} seconds`;
                }
                
                return {
                    success: true,
                    message: message,
                    data: {
                        type: type,
                        changes: results,
                        commandsExecuted: commands.length
                    }
                };
            } else {
                return result;
            }

        } catch (error) {
            return {
                success: false,
                message: `Error controlling world settings: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}