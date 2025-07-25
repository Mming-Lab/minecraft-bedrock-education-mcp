import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

/**
 * ヘリックス（螺旋）構造物を建築するツール
 * 
 * @description
 * 指定された中心点、半径、高さ、回転数から螺旋状の構造物を建築します。
 * 螺旋階段、DNAモデル、コルクスクリュータワーなどの螺旋形構造物に最適で、
 * Bresenhamアルゴリズムを応用した3D螺旋描画で連続した構造を実現します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildHelixTool();
 * 
 * // 時計回りの螺旋階段を建築
 * await tool.execute({
 *   centerX: 0, centerY: 64, centerZ: 0,
 *   radius: 5, height: 20, turns: 3,
 *   material: "oak_stairs",
 *   clockwise: true
 * });
 * 
 * // 反時計回りのDNAモデルを建築
 * await tool.execute({
 *   centerX: 50, centerY: 70, centerZ: 50,
 *   radius: 3, height: 15, turns: 2.5,
 *   material: "glowstone",
 *   clockwise: false
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildHelixTool extends BaseTool {
    readonly name = 'build_helix';
    readonly description = 'Build HELIX/SPIRAL: spiral staircase, corkscrew, DNA model, twisted tower. Requires: centerX,centerY,centerZ,radius,height,turns. Optional: axis,direction,chirality';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            centerX: {
                type: 'number',
                description: 'Center X coordinate'
            },
            centerY: {
                type: 'number',
                description: 'Bottom Y coordinate'
            },
            centerZ: {
                type: 'number',
                description: 'Center Z coordinate'
            },
            radius: {
                type: 'number',
                description: 'How wide the spiral is (distance from center). Small spiral=3, Medium=8, Large=15. Larger radius = wider staircases',
                minimum: 1,
                maximum: 50
            },
            height: {
                type: 'number',
                description: 'How tall the spiral is (total vertical height). Short=10, Medium=25, Tall=50. Each turn uses height/turns blocks vertically',
                minimum: 2,
                maximum: 100
            },
            turns: {
                type: 'number',
                description: 'How many complete rotations. Few turns=gentle slope (1-2), Many turns=steep spiral (5-10). 0.5=half turn, 1.5=one and half turns',
                minimum: 0.5,
                maximum: 20
            },
            material: {
                type: 'string',
                description: 'Block type to build with (e.g. stairs for actual staircases, stone for pillars, glowstone for decorative spirals)',
                default: 'minecraft:stone'
            },
            clockwise: {
                type: 'boolean',
                description: 'Rotation direction: true=clockwise (right-hand spiral), false=counter-clockwise (left-hand spiral)',
                default: true
            },
            axis: {
                type: 'string',
                description: 'Helix axis direction: x (east-west), y (up-down), z (north-south)',
                enum: ['x', 'y', 'z'],
                default: 'y'
            },
            direction: {
                type: 'string',
                description: 'Growth direction along axis: positive or negative',
                enum: ['positive', 'negative'],
                default: 'positive'
            },
            chirality: {
                type: 'string',
                description: 'Helix handedness: right (clockwise from growth direction), left (counter-clockwise)',
                enum: ['right', 'left'],
                default: 'right'
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius', 'height', 'turns']
    };

    /**
     * ヘリックス（螺旋）構造物を建築します
     * 
     * @param args - 建築パラメータ
     * @param args.centerX - 中心X座標（東西方向の中心位置）
     * @param args.centerY - 中心Y座標（開始高座、螺旋の最下部）
     * @param args.centerZ - 中心Z座標（南北方向の中心位置）
     * @param args.radius - 螺旋の半径（中心からの距離、1-50の範囲）
     * @param args.height - 螺旋の高さ（全体の高さ、2-100の範囲）
     * @param args.turns - 完全回転数（0.5-20の範囲、0.5は半回転）
     * @param args.material - 使用するブロック素材（デフォルト: "minecraft:stone"）
     * @param args.clockwise - 回転方向（true: 時計回り、false: 反時計回り、デフォルト: true）
     * @returns 建築実行結果
     * 
     * @throws 半径が範囲外の場合（1-50の範囲外）
     * @throws 高さが範囲外の場合（2-100の範囲外）
     * @throws 回転数が範囲外の場合（0.5-20の範囲外）
     * @throws ヘリックスが有効座標範囲を超える場合
     * @throws ブロック数が制限を超える場合（5000ブロック超過）
     * 
     * @example
     * ```typescript
     * // 緊密な螺旋タワーを建築
     * const result = await tool.execute({
     *   centerX: 100, centerY: 64, centerZ: 100,
     *   radius: 4, height: 25, turns: 5,
     *   material: "cobblestone",
     *   clockwise: true
     * });
     * 
     * if (result.success) {
     *   console.log(`ヘリックス建築完了: ${result.data.blocksPlaced}ブロック配置`);
     * }
     * ```
     */
    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        height: number;
        turns: number;
        material?: string;
        clockwise?: boolean;
        axis?: 'x' | 'y' | 'z';
        direction?: 'positive' | 'negative';
        chirality?: 'right' | 'left';
    }): Promise<ToolCallResult> {
        try {
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: "World not available. Ensure Minecraft is connected." };
            }

            // 引数の基本検証
            if (!args || typeof args !== 'object') {
                return this.createErrorResponse('Invalid arguments provided');
            }

            if (!this.validateArgs(args)) {
                return this.createErrorResponse('Missing required arguments: centerX, centerY, centerZ, radius, height, turns');
            }

            const { 
                centerX, 
                centerY, 
                centerZ, 
                radius, 
                height, 
                turns, 
                material = 'minecraft:stone', 
                clockwise = true,
                axis = 'y',
                direction = 'positive',
                chirality = 'right'
            } = args;
            
            // 座標の整数化
            const center = {
                x: this.normalizeCoordinate(centerX),
                y: this.normalizeCoordinate(centerY),
                z: this.normalizeCoordinate(centerZ)
            };
            
            const radiusInt = Math.round(radius);
            const heightInt = Math.round(height);
            
            // パラメータ検証
            if (radiusInt < 1 || radiusInt > 50) {
                return this.createErrorResponse('Radius must be between 1 and 50');
            }
            
            if (heightInt < 2 || heightInt > 100) {
                return this.createErrorResponse('Height must be between 2 and 100');
            }
            
            if (turns < 0.5 || turns > 20) {
                return this.createErrorResponse('Turns must be between 0.5 and 20');
            }
            
            // 座標範囲の検証
            const minX = center.x - radiusInt;
            const maxX = center.x + radiusInt;
            const minY = center.y;
            const maxY = center.y + heightInt - 1;
            const minZ = center.z - radiusInt;
            const maxZ = center.z + radiusInt;
            
            if (!this.validateCoordinates(minX, minY, minZ) || 
                !this.validateCoordinates(maxX, maxY, maxZ)) {
                return this.createErrorResponse('Helix extends beyond valid coordinates');
            }
            
            // ブロックIDの正規化
            const blockId = this.normalizeBlockId(material);
            
            const commands: string[] = [];
            let blocksPlaced = 0;
            
            // 座標変換ヘルパー関数
            const transformCoordinates = (localX: number, localY: number, localZ: number): {x: number, y: number, z: number} => {
                const directionMultiplier = direction === 'positive' ? 1 : -1;
                const chiralityMultiplier = chirality === 'right' ? 1 : -1;
                
                switch (axis) {
                    case 'x':
                        // X軸らせん: YZ平面で回転、X方向に進行
                        return {
                            x: center.x + localY * directionMultiplier,
                            y: center.y + localX * chiralityMultiplier,
                            z: center.z + localZ * chiralityMultiplier
                        };
                    case 'z':
                        // Z軸らせん: XY平面で回転、Z方向に進行
                        return {
                            x: center.x + localX * chiralityMultiplier,
                            y: center.y + localZ * chiralityMultiplier,
                            z: center.z + localY * directionMultiplier
                        };
                    case 'y':
                    default:
                        // Y軸らせん（デフォルト）: XZ平面で回転、Y方向に進行
                        return {
                            x: center.x + localX * chiralityMultiplier,
                            y: center.y + localY * directionMultiplier,
                            z: center.z + localZ * chiralityMultiplier
                        };
                }
            };
            
            // 3D Bresenham風螺旋アルゴリズム（候補点3つの決定版）
            const totalAngle = turns * 2 * Math.PI; // 総回転角度（ラジアン）
            const rotationDirection = clockwise ? 1 : -1; // 回転方向
            
            const placedPositions = new Set<string>();
            
            // 螺旋の現在位置（ループ内で更新）
            let currentX = center.x;
            let currentY = center.y;
            let currentZ = center.z;
            
            // 真のBresenham螺旋: Midpoint circle + 3D line algorithm組み合わせ
            
            // 螺旋パラメータ
            const totalSteps = Math.round(2 * Math.PI * radiusInt * turns); // 円周 × 回転数
            
            // 3D Bresenham line algorithm for height control (参考コード準拠)
            const dx = 0; // X軸は円運動なので0
            const dy = heightInt - 1; // Y軸の変化量
            const dz = 0; // Z軸は円運動なので0
            const dm = totalSteps; // 主軸 (螺旋ステップ数)
            
            let y1_err = Math.floor(dm / 2);
            
            // 円のBresenham準拠: 角度を離散化
            const totalAngleSteps = Math.round(totalAngle * radiusInt / Math.PI); // 角度の離散化
            
            // 螺旋進行（ローカル座標系）
            let localSpiralX = radiusInt; // 開始点 (ローカル座標の東側)
            let localSpiralY = 0; // 高さの開始点
            let localSpiralZ = 0; // 開始点 (ローカル座標の中心)
            
            // 最初のブロック配置（座標変換適用）
            let worldPos = transformCoordinates(localSpiralX, localSpiralY, localSpiralZ);
            commands.push(`setblock ${worldPos.x} ${worldPos.y} ${worldPos.z} ${blockId}`);
            placedPositions.add(`${worldPos.x},${worldPos.y},${worldPos.z}`);
            blocksPlaced++;
            
            // 円のMidpoint algorithm風に角度を進行
            let angleStep = 0;
            const maxAngleSteps = Math.round(totalAngle * 180 / Math.PI); // 度数で管理
            
            for (let step = 1; step < totalSteps && angleStep < maxAngleSteps; step++) {
                // 角度進行 (Midpoint circle algorithm風)
                const progress = step / totalSteps;
                const currentAngle = progress * totalAngle * rotationDirection;
                
                // 次の円周位置 (ローカル座標系)
                const nextLocalX = Math.round(radiusInt * Math.cos(currentAngle));
                const nextLocalZ = Math.round(radiusInt * Math.sin(currentAngle));
                
                // 隣接性チェック: 前の位置から最大1ブロック差
                const deltaX = Math.abs(nextLocalX - localSpiralX);
                const deltaZ = Math.abs(nextLocalZ - localSpiralZ);
                
                // 隣接保証: 前の点から離れすぎている場合は中間点を補間
                if (deltaX > 1 || deltaZ > 1) {
                    // Bresenham line algorithmで中間点を補間
                    const stepX = nextLocalX > localSpiralX ? 1 : (nextLocalX < localSpiralX ? -1 : 0);
                    const stepZ = nextLocalZ > localSpiralZ ? 1 : (nextLocalZ < localSpiralZ ? -1 : 0);
                    
                    localSpiralX += stepX;
                    localSpiralZ += stepZ;
                } else {
                    // 隣接している場合は直接移動
                    localSpiralX = nextLocalX;
                    localSpiralZ = nextLocalZ;
                }
                
                // 3D Bresenham height progression (参考コード準拠)
                y1_err -= dy;
                if (y1_err < 0) {
                    y1_err += dm;
                    localSpiralY += 1; // 高さを1ブロック上昇
                }
                
                // ブロック配置（座標変換適用）
                worldPos = transformCoordinates(localSpiralX, localSpiralY, localSpiralZ);
                const posKey = `${worldPos.x},${worldPos.y},${worldPos.z}`;
                if (!placedPositions.has(posKey) && localSpiralY < heightInt) {
                    placedPositions.add(posKey);
                    commands.push(`setblock ${worldPos.x} ${worldPos.y} ${worldPos.z} ${blockId}`);
                    blocksPlaced++;
                }
                
                angleStep++;
            }
            
            // ブロック数制限チェック
            if (commands.length > 3000) {
                return this.createErrorResponse('Too many blocks to place (maximum 3000)');
            }
            
            try {
                // Socket-BE APIを使用した実装
                
                // 基本的な実装：コマンド配列をSocket-BE API呼び出しに変換
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
                            
                            // 制限チェック
                            if (blocksPlaced > 5000) {
                                return this.createErrorResponse('Too many blocks to place (maximum 5000)');
                            }
                        }
                    }
                }
                
                return this.createSuccessResponse(
                    `Helix built with ${blockId} at center (${center.x},${center.y},${center.z}) radius ${radiusInt}, height ${heightInt}, ${turns} turns, ${clockwise ? 'clockwise' : 'counter-clockwise'}. Axis: ${axis}, Direction: ${direction}, Chirality: ${chirality}. Placed ${blocksPlaced} blocks.`,
                    {
                        type: 'helix',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
                        turns: turns,
                        material: blockId,
                        clockwise: clockwise,
                        axis: axis,
                        direction: direction,
                        chirality: chirality,
                        blocksPlaced: blocksPlaced,
                        apiUsed: 'Socket-BE'
                    }
                );
            } catch (buildError) {
                return this.createErrorResponse(`Building error: ${buildError instanceof Error ? buildError.message : String(buildError)}`);
            }

        } catch (error) {
            return this.createErrorResponse(
                `Error building helix: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}