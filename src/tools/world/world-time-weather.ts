import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ワールドの時間・天候制御ツール
 */
export class WorldTimeWeatherTool extends BaseTool {
    readonly name = 'world_time_weather';
    readonly description = 'Control world time and weather settings';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: 'Control type',
                enum: ['time', 'weather', 'both']
            },
            time: {
                type: 'string',
                description: 'Time setting (when type=time or both)',
                enum: ['day', 'night', 'noon', 'midnight', 'sunrise', 'sunset']
            },
            timeValue: {
                type: 'number',
                description: 'Specific time value in ticks (0-24000, when type=time or both)',
                minimum: 0,
                maximum: 24000
            },
            weather: {
                type: 'string',
                description: 'Weather setting (when type=weather or both)',
                enum: ['clear', 'rain', 'thunder']
            },
            duration: {
                type: 'number',
                description: 'Weather duration in seconds (when type=weather or both)',
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