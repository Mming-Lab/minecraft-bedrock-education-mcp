import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

/**
 * パラボロイド（衛星皿状）構造物を建築するツール
 * 
 * @description
 * 指定された中心点、半径、高さからパラボロイドを建築します。
 * 衛星アンテナ、ボウル、皿型構造物などの特徴的な形状の構造物に最適で、
 * 数学的な放物面方程式を使用して正確な曲線を実現します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildParaboloidTool();
 * 
 * // 衛星アンテナ型の実体構造を建築
 * await tool.execute({
 *   centerX: 0, centerY: 64, centerZ: 0,
 *   radius: 10, height: 12,
 *   material: "iron_block",
 *   hollow: false
 * });
 * 
 * // 中空のボウル型構造を建築
 * await tool.execute({
 *   centerX: 50, centerY: 70, centerZ: 50,
 *   radius: 8, height: 6,
 *   material: "quartz_block",
 *   hollow: true
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildParaboloidTool extends BaseTool {
    readonly name = 'build_paraboloid';
    readonly description = 'Build PARABOLOID: satellite dish, bowl, dish, parabolic. Requires: centerX,centerY,centerZ,radius,height. Optional: axis,direction';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            centerX: {
                type: 'number',
                description: 'Center X coordinate (east-west position of paraboloid base center)'
            },
            centerY: {
                type: 'number',
                description: 'Center Y coordinate (height/vertical position of paraboloid base, typically 64-100)'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate (north-south position of paraboloid base center)'
            },
            radius: {
                type: 'number',
                description: 'Maximum radius at the top of the paraboloid in blocks. Small: 3-5, Medium: 8-12, Large: 15-20',
                minimum: 2,
                maximum: 50
            },
            height: {
                type: 'number',
                description: 'Height of the paraboloid in blocks. Small: 5-8, Medium: 10-15, Large: 20-30',
                minimum: 1,
                maximum: 50
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone, glass, wool, concrete, etc.)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for dish shell, or solid (false) for full paraboloid',
                default: false
            },
            axis: {
                type: 'string',
                description: 'Paraboloid axis direction: x (east-west), y (up-down), z (north-south)',
                enum: ['x', 'y', 'z'],
                default: 'y'
            },
            direction: {
                type: 'string',
                description: 'Opening direction: positive (opens toward +axis), negative (opens toward -axis)',
                enum: ['positive', 'negative'],
                default: 'positive'
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius', 'height']
    };

    /**
     * パラボロイド（衛星皿状）構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 中心X座標（東西方向のベース中心位置）
     * @param args.centerY - 中心Y座標（ベースの高さ、通常64-100）
     * @param args.centerZ - 中心Z座標（南北方向のベース中心位置）
     * @param args.radius - 最大半径（パラボロイド上部の半径、2-50の範囲）
     * @param args.height - パラボロイドの高さ（ブロック単位、1-50の範囲）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.hollow - 中空にするかどうか（デフォルト: false）
     * @returns 建築実行結果
     * 
     * @throws Y座標が範囲外の場合（-64から320の範囲外）
     * @throws 半径が範囲外の場合（2-50の範囲外）
     * @throws 高さが範囲外の場合（1-50の範囲外）
     * @throws ブロック数が制限を超える場合（5000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 小型の装飾的なボウルを建築
     * const result = await tool.execute({
     *   centerX: 0, centerY: 65, centerZ: 0,
     *   radius: 6, height: 4,
     *   material: "smooth_quartz",
     *   hollow: true
     * });
     * 
     * if (result.success) {
     *   console.log(`パラボロイド建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        height: number;
        material?: string;
        hollow?: boolean;
        axis?: 'x' | 'y' | 'z';
        direction?: 'positive' | 'negative';
    }): Promise<ToolCallResult> {
        try {
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: "World not available. Ensure Minecraft is connected." };
            }

            const { centerX, centerY, centerZ, radius, height, material = 'minecraft:stone', hollow = false, axis = 'y', direction = 'positive' } = args;
            
            // 座標の整数化
            const center = {
                x: Math.floor(centerX),
                y: Math.floor(centerY),
                z: Math.floor(centerZ)
            };
            
            // Y座標の検証
            if (center.y < -64 || center.y + height > 320) {
                return {
                    success: false,
                    message: 'Paraboloid extends beyond valid Y coordinates (-64 to 320)'
                };
            }
            
            // 半径と高さの検証
            if (radius < 2 || radius > 50) {
                return {
                    success: false,
                    message: 'Radius must be between 2 and 50'
                };
            }
            
            if (height < 1 || height > 50) {
                return {
                    success: false,
                    message: 'Height must be between 1 and 50'
                };
            }
            
            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            const radiusInt = Math.round(radius);
            const heightInt = Math.round(height);
            
            // 座標変換ヘルパー関数
            const transformCoordinates = (localX: number, localY: number, localZ: number): {x: number, y: number, z: number} => {
                const directionMultiplier = direction === 'positive' ? 1 : -1;
                
                switch (axis) {
                    case 'x':
                        // X軸パラボロイド: Y-Z平面で展開、X方向に開く
                        return {
                            x: center.x + localY * directionMultiplier,
                            y: center.y + localZ,
                            z: center.z + localX
                        };
                    case 'z':
                        // Z軸パラボロイド: X-Y平面で展開、Z方向に開く
                        return {
                            x: center.x + localX,
                            y: center.y + localZ,
                            z: center.z + localY * directionMultiplier
                        };
                    case 'y':
                    default:
                        // Y軸パラボロイド（デフォルト）: X-Z平面で展開、Y方向に開く
                        return {
                            x: center.x + localX,
                            y: center.y + localY * directionMultiplier,
                            z: center.z + localZ
                        };
                }
            };
            const radiusSquared = radiusInt * radiusInt;
            
            // パラボロイドの方程式: z = (x² + y²) / (4 * focal_length)
            // focal_lengthを調整してheightに合わせる
            const focalLength = radiusSquared / (4 * heightInt);
            
            for (let y = 0; y < heightInt; y++) {
                // 現在の高さでのパラボラ半径を計算
                const currentRadiusSquared = 4 * focalLength * y;
                const currentRadius = Math.sqrt(currentRadiusSquared);
                const currentRadiusInt = Math.floor(currentRadius);
                
                if (currentRadiusInt > radiusInt) continue; // 最大半径を超えた場合はスキップ
                
                const innerRadius = hollow ? Math.max(0, currentRadiusInt - 1) : 0;
                const innerRadiusSquared = innerRadius * innerRadius;
                
                for (let x = -currentRadiusInt; x <= currentRadiusInt; x++) {
                    const xSquared = x * x;
                    if (xSquared > currentRadiusSquared) continue;
                    
                    const maxZSquared = currentRadiusSquared - xSquared;
                    const maxZ = Math.floor(Math.sqrt(maxZSquared));
                    
                    for (let z = -maxZ; z <= maxZ; z++) {
                        const distanceSquared = xSquared + z * z;
                        
                        if (distanceSquared <= currentRadiusSquared &&
                            (!hollow || distanceSquared >= innerRadiusSquared)) {
                            // 座標変換を適用
                            const worldPos = transformCoordinates(x, y, z);
                            
                            commands.push(`setblock ${worldPos.x} ${worldPos.y} ${worldPos.z} ${blockId}`);
                            blocksPlaced++;
                        }
                    }
                }
            }
            
            if (commands.length > 1000) {
                return {
                    success: false,
                    message: 'Too many blocks to place (maximum 1000)'
                };
            }
            
            try {
                // Socket-BE APIを使用した実装
                let blocksPlaced = 0;
                
                // コマンド配列をSocket-BE API呼び出しに変換
                for (const command of commands) {
                    if (command.startsWith('setblock ')) {
                        const parts = command.split(' ');
                        if (parts.length >= 5) {
                            const x = parseInt(parts[1]);
                            const y = parseInt(parts[2]);
                            const z = parseInt(parts[3]);
                            const block = parts[4];
                            
                            await this.world.setBlock({x, y, z}, block);
                            blocksPlaced++;
                            
                            if (blocksPlaced > 5000) {
                                return this.createErrorResponse('Too many blocks to place (maximum 5000)');
                            }
                        }
                    }
                }
                
                return this.createSuccessResponse(
                    `${hollow ? 'Hollow' : 'Solid'} paraboloid built with ${blockId} at center (${center.x},${center.y},${center.z}) with radius ${radiusInt} and height ${heightInt}. Axis: ${axis}, Direction: ${direction}. Placed ${blocksPlaced} blocks.`,
                    {
                        type: 'paraboloid',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
                        material: blockId,
                        hollow: hollow,
                        axis: axis,
                        direction: direction,
                        blocksPlaced: blocksPlaced,
                        apiUsed: 'Socket-BE'
                    }
                );
            } catch (buildError) {
                return this.createErrorResponse(`Building error: ${buildError instanceof Error ? buildError.message : String(buildError)}`);
            }

        } catch (error) {
            return {
                success: false,
                message: `Error building paraboloid: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}