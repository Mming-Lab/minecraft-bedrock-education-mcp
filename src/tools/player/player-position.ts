import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * プレイヤーの位置情報を取得するツール
 */
export class PlayerPositionTool extends BaseTool {
    readonly name = 'player_position';
    readonly description = 'Get the current position and rotation of the player using WebSocket QueryTarget command';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {},
        required: []
    };

    async execute(args: {}): Promise<ToolCallResult> {
        try {
            // QueryTargetコマンドを使用してプレイヤー位置を取得
            // WebSocket専用機能：プレイヤー情報の詳細取得
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
                            
                            return {
                                success: true,
                                message: `Player position: X=${x.toFixed(2)}, Y=${y.toFixed(2)}, Z=${z.toFixed(2)}, Rotation: ${yRot.toFixed(1)}°, Dimension: ${dimension}`,
                                data: {
                                    position: { x, y, z },
                                    rotation: { yaw: yRot },
                                    dimension: dimension,
                                    uniqueId: player.uniqueId,
                                    command: 'querytarget @s'
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
                message: `Error getting player position: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}