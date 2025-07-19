import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * プレイヤーの足元位置情報を取得するツール
 * 内部的にはQueryTargetで頭部座標を取得し、足元座標（Y-1.62）に変換して返します
 * 回転角度は一般的なコンパス表記（北=0°）に変換して返します
 */
export class PlayerPositionTool extends BaseTool {
    readonly name = 'player_position';
    readonly description = 'Get the current position and rotation of the player using WebSocket QueryTarget command. Returns the player\'s feet position coordinates (converted from head position by subtracting 1.62 blocks from Y coordinate). Rotation is converted to standard compass bearing (North=0°, East=90°, South=180°, West=270°).';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {},
        required: []
    };

    async execute(args: {}): Promise<ToolCallResult> {
        try {
            // QueryTargetコマンドを使用してプレイヤーの頭部位置を取得
            // WebSocket専用機能：プレイヤー情報の詳細取得
            // 注意: QueryTargetで取得される座標は頭部位置のため、足元座標に変換する
            const result = await this.executeCommand('querytarget @s');
            
            if (result.success && result.data) {
                // QueryTargetレスポンスから位置情報を抽出
                const responseData = result.data;
                
                try {
                    // detailsフィールドからJSONデータを解析
                    const detailsJson = responseData.details || responseData.statusMessage;
                    if (detailsJson) {
                        const playerData = JSON.parse(detailsJson);
                        
                        if (Array.isArray(playerData) && playerData.length > 0) {
                            const player = playerData[0];
                            const { x, y, z } = player.position;
                            const yRot = player.yRot || 0;
                            const dimension = player.dimension || 0;
                            
                            // 頭部座標から足元座標に変換（Y座標から1.62ブロック減算）
                            const feetY = y - 1.62;
                            
                            // Minecraftの角度を一般的なコンパス角度に変換
                            // Minecraft: 南=0°, 西=90°, 北=180°/-180°, 東=-90°/270°
                            // 一般的: 北=0°, 東=90°, 南=180°, 西=270°
                            const minecraftYaw = yRot;
                            const compassBearing = (90 - minecraftYaw + 360) % 360;
                            
                            return {
                                success: true,
                                message: `Player position: X=${x.toFixed(2)}, Y=${feetY.toFixed(2)}, Z=${z.toFixed(2)}, Bearing: ${compassBearing.toFixed(1)}°, Dimension: ${dimension}`,
                                data: {
                                    position: { x, y: feetY, z },
                                    rotation: { 
                                        bearing: compassBearing,
                                        minecraftYaw: minecraftYaw
                                    },
                                    dimension: dimension,
                                    uniqueId: player.uniqueId,
                                    command: 'querytarget @s',
                                    note: 'Position coordinates represent feet position (converted from head position). Bearing uses standard compass notation (N=0°, E=90°, S=180°, W=270°).'
                                }
                            };
                        }
                    }
                } catch (parseError) {
                    // JSON解析エラーの場合、rawレスポンスを返す
                }
                
                // フォールバック：レスポンスデータの構造をログ出力してデバッグ
                return {
                    success: true,
                    message: 'QueryTarget command executed successfully',
                    data: {
                        rawResponse: responseData,
                        command: 'querytarget @s',
                        note: 'Response structure may need adjustment - check server logs'
                    }
                };
            } else {
                return {
                    success: false,
                    message: 'Failed to execute QueryTarget command or no response data received'
                };
            }

        } catch (error) {
            return {
                success: false,
                message: `Error getting player head position: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
}