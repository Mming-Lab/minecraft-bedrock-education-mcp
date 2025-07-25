import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

/**
 * ハイパーボロイド（冷却塔状）構造物を建築するツール
 * 
 * @description
 * 指定されたベース半径、ウエスト半径、高さからハイパーボロイドを建築します。
 * 冷却塔、砂時計、鎖型タワーなどの特徴的な形状の構造物に最適で、
 * 数学的な双曲面方程式を使用して正確な形状を生成します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildHyperboloidTool();
 * 
 * // 冷却塔型の実体タワーを建築
 * await tool.execute({
 *   centerX: 0, centerY: 64, centerZ: 0,
 *   baseRadius: 12, waistRadius: 6, height: 30,
 *   material: "concrete",
 *   hollow: false
 * });
 * 
 * // 中空の装飾的な鎖型構造を建築
 * await tool.execute({
 *   centerX: 50, centerY: 70, centerZ: 50,
 *   baseRadius: 8, waistRadius: 3, height: 20,
 *   material: "glass",
 *   hollow: true
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildHyperboloidTool extends BaseTool {
    readonly name = 'build_hyperboloid';
    readonly description = 'Build HYPERBOLOID: cooling tower, hourglass, nuclear tower. Requires: centerX,centerY,centerZ,baseRadius,waistRadius,height. Optional: axis';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            centerX: {
                type: 'number',
                description: 'Center X coordinate (east-west position of hyperboloid base center)'
            },
            centerY: {
                type: 'number',
                description: 'Center Y coordinate (height/vertical position of hyperboloid base, typically 64-100)'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate (north-south position of hyperboloid base center)'
            },
            baseRadius: {
                type: 'number',
                description: 'Radius at the base in blocks. Small: 5-8, Medium: 10-15, Large: 20-30',
                minimum: 3,
                maximum: 50
            },
            waistRadius: {
                type: 'number',
                description: 'Radius at the narrowest point (waist) in blocks. Should be smaller than baseRadius',
                minimum: 1,
                maximum: 30
            },
            height: {
                type: 'number',
                description: 'Total height of the hyperboloid in blocks. Small: 10-15, Medium: 20-30, Large: 40-60',
                minimum: 4,
                maximum: 100
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stone, glass, wool, concrete, etc.)',
                default: 'minecraft:stone'
            },
            hollow: {
                type: 'boolean',
                description: 'Make it hollow (true) for tower shell, or solid (false) for full hyperboloid',
                default: false
            },
            axis: {
                type: 'string',
                description: 'Hyperboloid axis direction: x (east-west), y (up-down), z (north-south)',
                enum: ['x', 'y', 'z'],
                default: 'y'
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'baseRadius', 'waistRadius', 'height']
    };

    /**
     * ハイパーボロイド（冷却塔状）構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 中心X座標（東西方向のベース中心位置）
     * @param args.centerY - 中心Y座標（ベースの高さ、通常64-100）
     * @param args.centerZ - 中心Z座標（南北方向のベース中心位置）
     * @param args.baseRadius - ベース部の半径（ブロック単位、3-50の範囲）
     * @param args.waistRadius - ウエスト（最細部）の半径（baseRadiusより小さ1-30の範囲）
     * @param args.height - ハイパーボロイドの高さ（ブロック単位、4-100の範囲）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.hollow - 中空にするかどうか（デフォルト: false）
     * @returns 建築実行結果
     * 
     * @throws Y座標が範囲外の場合（-64から320の範囲外）
     * @throws ベース半径が範囲外の場合（3-50の範囲外）
     * @throws ウエスト半径が範囲外の場合（1-30の範囲外）
     * @throws ウエスト半径がベース半径以上の場合
     * @throws 高さが範囲外の場合（4-100の範囲外）
     * @throws ブロック数が制限を超える場合（5000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 小型の装飾的な鎖型構造を建築
     * const result = await tool.execute({
     *   centerX: 0, centerY: 70, centerZ: 0,
     *   baseRadius: 6, waistRadius: 2, height: 15,
     *   material: "quartz_block",
     *   hollow: true
     * });
     * 
     * if (result.success) {
     *   console.log(`ハイパーボロイド建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        baseRadius: number;
        waistRadius: number;
        height: number;
        material?: string;
        hollow?: boolean;
        axis?: 'x' | 'y' | 'z';
    }): Promise<ToolCallResult> {
        try {
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: "World not available. Ensure Minecraft is connected." };
            }

            const { centerX, centerY, centerZ, baseRadius, waistRadius, height, material = 'minecraft:stone', hollow = false, axis = 'y' } = args;
            
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
                    message: 'Hyperboloid extends beyond valid Y coordinates (-64 to 320)'
                };
            }
            
            // パラメータの検証
            if (baseRadius < 3 || baseRadius > 50) {
                return {
                    success: false,
                    message: 'Base radius must be between 3 and 50'
                };
            }
            
            if (waistRadius < 1 || waistRadius > 30) {
                return {
                    success: false,
                    message: 'Waist radius must be between 1 and 30'
                };
            }
            
            if (waistRadius >= baseRadius) {
                return {
                    success: false,
                    message: 'Waist radius must be smaller than base radius'
                };
            }
            
            if (height < 4 || height > 100) {
                return {
                    success: false,
                    message: 'Height must be between 4 and 100'
                };
            }
            
            // ブロックIDの正規化
            let blockId = material;
            if (!blockId.includes(':')) {
                blockId = `minecraft:${blockId}`;
            }
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            const baseRadiusInt = Math.round(baseRadius);
            const waistRadiusInt = Math.round(waistRadius);
            const heightInt = Math.round(height);
            
            // 座標変換ヘルパー関数
            const transformCoordinates = (localX: number, localY: number, localZ: number): {x: number, y: number, z: number} => {
                switch (axis) {
                    case 'x':
                        // X軸ハイパーボロイド: Y-Z平面で展開、X方向に伸びる
                        return {
                            x: center.x + localY,
                            y: center.y + localZ,
                            z: center.z + localX
                        };
                    case 'z':
                        // Z軸ハイパーボロイド: X-Y平面で展開、Z方向に伸びる
                        return {
                            x: center.x + localX,
                            y: center.y + localZ,
                            z: center.z + localY
                        };
                    case 'y':
                    default:
                        // Y軸ハイパーボロイド（デフォルト）: X-Z平面で展開、Y方向に伸びる
                        return {
                            x: center.x + localX,
                            y: center.y + localY,
                            z: center.z + localZ
                        };
                }
            };
            const halfHeight = Math.floor(heightInt / 2);
            
            // 双曲面の形状パラメータ
            const a = waistRadiusInt; // 最小半径
            const b = baseRadiusInt - waistRadiusInt; // 半径の変化幅
            
            for (let y = 0; y < heightInt; y++) {
                // 中心からの距離 (-1 to 1 の範囲)
                const t = (y - halfHeight) / halfHeight;
                
                // 双曲面の方程式: r(t) = a * sqrt(1 + (t*b/a)²)
                const currentRadius = a * Math.sqrt(1 + (t * b / a) * (t * b / a));
                const currentRadiusInt = Math.round(currentRadius);
                const currentRadiusSquared = currentRadiusInt * currentRadiusInt;
                
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
                    `${hollow ? 'Hollow' : 'Solid'} hyperboloid built with ${blockId} at center (${center.x},${center.y},${center.z}) with base radius ${baseRadiusInt}, waist radius ${waistRadiusInt}, and height ${heightInt}. Axis: ${axis}. Placed ${blocksPlaced} blocks.`,
                    {
                        type: 'hyperboloid',
                        center: center,
                        baseRadius: baseRadiusInt,
                        waistRadius: waistRadiusInt,
                        height: heightInt,
                        material: blockId,
                        hollow: hollow,
                        axis: axis,
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
                message: `Error building hyperboloid: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}