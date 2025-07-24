import { BaseTool } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * ヘリックス（螺旋）を建築するツール
 */
export class BuildHelixTool extends BaseTool {
    readonly name = 'build_helix';
    readonly description = 'Build a HELIX/SPIRAL. USE THIS when user asks for: "spiral staircase", "spiral", "corkscrew", "DNA model", "twisted tower", "spiral path". ALWAYS specify: centerX, centerY, centerZ, radius, height, turns. Example: centerX=0, centerY=64, centerZ=0, radius=5, height=20, turns=3';
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
            }
        },
        required: ['centerX', 'centerY', 'centerZ', 'radius', 'height', 'turns']
    };

    async execute(args: {
        centerX: number;
        centerY: number;
        centerZ: number;
        radius: number;
        height: number;
        turns: number;
        material?: string;
        clockwise?: boolean;
    }): Promise<ToolCallResult> {
        try {
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
                clockwise = true 
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
            
            // 3D Bresenham風螺旋アルゴリズム（候補点3つの決定版）
            const totalAngle = turns * 2 * Math.PI; // 総回転角度（ラジアン）
            const direction = clockwise ? 1 : -1; // 回転方向
            
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
            
            // 螺旋進行
            let spiralX = center.x + radiusInt; // 開始点 (東側)
            let spiralY = center.y;
            let spiralZ = center.z;
            
            // 最初のブロック配置
            commands.push(`setblock ${spiralX} ${spiralY} ${spiralZ} ${blockId}`);
            placedPositions.add(`${spiralX},${spiralY},${spiralZ}`);
            blocksPlaced++;
            
            // 円のMidpoint algorithm風に角度を進行
            let angleStep = 0;
            const maxAngleSteps = Math.round(totalAngle * 180 / Math.PI); // 度数で管理
            
            for (let step = 1; step < totalSteps && angleStep < maxAngleSteps; step++) {
                // 角度進行 (Midpoint circle algorithm風)
                const progress = step / totalSteps;
                const currentAngle = progress * totalAngle * direction;
                
                // 次の円周位置 (Bresenham決定パラメータ風)
                const nextX = center.x + Math.round(radiusInt * Math.cos(currentAngle));
                const nextZ = center.z + Math.round(radiusInt * Math.sin(currentAngle));
                
                // 隣接性チェック: 前の位置から最大1ブロック差
                const deltaX = Math.abs(nextX - spiralX);
                const deltaZ = Math.abs(nextZ - spiralZ);
                
                // 隣接保証: 前の点から離れすぎている場合は中間点を補間
                if (deltaX > 1 || deltaZ > 1) {
                    // Bresenham line algorithmで中間点を補間
                    const stepX = nextX > spiralX ? 1 : (nextX < spiralX ? -1 : 0);
                    const stepZ = nextZ > spiralZ ? 1 : (nextZ < spiralZ ? -1 : 0);
                    
                    spiralX += stepX;
                    spiralZ += stepZ;
                } else {
                    // 隣接している場合は直接移動
                    spiralX = nextX;
                    spiralZ = nextZ;
                }
                
                // 3D Bresenham height progression (参考コード準拠)
                y1_err -= dy;
                if (y1_err < 0) {
                    y1_err += dm;
                    spiralY += 1; // 高さを1ブロック上昇
                }
                
                // ブロック配置
                const posKey = `${spiralX},${spiralY},${spiralZ}`;
                if (!placedPositions.has(posKey) && spiralY < center.y + heightInt) {
                    placedPositions.add(posKey);
                    commands.push(`setblock ${spiralX} ${spiralY} ${spiralZ} ${blockId}`);
                    blocksPlaced++;
                    
                    currentX = spiralX;
                    currentY = spiralY;
                    currentZ = spiralZ;
                }
                
                angleStep++;
            }
            
            // ブロック数制限チェック
            if (commands.length > 3000) {
                return this.createErrorResponse('Too many blocks to place (maximum 3000)');
            }
            
            const result = await this.executeBatch(commands, false);
            
            if (result.success) {
                return this.createSuccessResponse(
                    `Helix built with ${blockId} at center (${center.x},${center.y},${center.z}) radius ${radiusInt}, height ${heightInt}, ${turns} turns, ${clockwise ? 'clockwise' : 'counter-clockwise'}`,
                    {
                        type: 'helix',
                        center: center,
                        radius: radiusInt,
                        height: heightInt,
                        turns: turns,
                        material: blockId,
                        clockwise: clockwise,
                        blocksPlaced: blocksPlaced
                    }
                );
            } else {
                return result;
            }

        } catch (error) {
            return this.createErrorResponse(
                `Error building helix: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}