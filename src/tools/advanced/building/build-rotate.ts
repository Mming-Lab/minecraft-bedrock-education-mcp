import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { rotatePoint3D } from '../../../utils/math/rotation-algorithms';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';

/**
 * 構造物回転ツール
 * 
 * @description
 * 指定された領域の構造物を回転軸周りに回転させてコピーします。
 * 建物の回転コピー、対称構造の作成、装飾的な回転パターンの作成に最適で、
 * ロドリゲスの回転公式を使用した正確な3D回転を実現します。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildRotateTool();
 * 
 * // 家をY軸周りに90度回転してコピー
 * await tool.execute({
 *   sourceCorner1X: 0, sourceCorner1Y: 64, sourceCorner1Z: 0,
 *   sourceCorner2X: 10, sourceCorner2Y: 70, sourceCorner2Z: 10,
 *   originX: 5, originY: 67, originZ: 5,
 *   axis: "y", angle: 90,
 *   material: "oak_planks"
 * });
 * 
 * // 柱をX軸周りに45度傾けてコピー
 * await tool.execute({
 *   sourceCorner1X: 20, sourceCorner1Y: 64, sourceCorner1Z: 0,
 *   sourceCorner2X: 22, sourceCorner2Y: 80, sourceCorner2Z: 2,
 *   originX: 21, originY: 64, originZ: 1,
 *   axis: "x", angle: 45,
 *   material: "stone"
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildRotateTool extends BaseTool {
    readonly name = 'build_rotate';
    readonly description = 'Rotate and copy a structure around a pivot point. Perfect for creating rotated copies of buildings, making symmetrical structures, or spinning decorations. Example: rotate a house 90° around its center to create multiple orientations';
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Build action to perform',
                enum: ['build'],
                default: 'build'
            },
            sourceCorner1X: {
                type: 'number',
                description: 'Source region corner 1 X coordinate'
            },
            sourceCorner1Y: {
                type: 'number',
                description: 'Source region corner 1 Y coordinate'
            },
            sourceCorner1Z: {
                type: 'number',
                description: 'Source region corner 1 Z coordinate'
            },
            sourceCorner2X: {
                type: 'number',
                description: 'Source region corner 2 X coordinate'
            },
            sourceCorner2Y: {
                type: 'number',
                description: 'Source region corner 2 Y coordinate'
            },
            sourceCorner2Z: {
                type: 'number',
                description: 'Source region corner 2 Z coordinate'
            },
            originX: {
                type: 'number',
                description: 'Center of rotation X coordinate'
            },
            originY: {
                type: 'number',
                description: 'Center of rotation Y coordinate'
            },
            originZ: {
                type: 'number',
                description: 'Center of rotation Z coordinate'
            },
            axis: {
                type: 'string',
                description: 'Rotation axis: y=spin horizontally (most common), x=tip forward/backward, z=roll left/right',
                enum: ['x', 'y', 'z']
            },
            angle: {
                type: 'number',
                description: 'Rotation angle in degrees. Common angles: 90=quarter turn, 180=half turn, 270=three-quarter turn, 45=diagonal',
                minimum: 0,
                maximum: 360
            },
            material: {
                type: 'string',
                description: 'Block type to build the rotated copy with (e.g. same as original, or different material for contrast)',
                default: 'minecraft:stone'
            }
        },
        required: ['sourceCorner1X', 'sourceCorner1Y', 'sourceCorner1Z', 'sourceCorner2X', 'sourceCorner2Y', 'sourceCorner2Z', 'originX', 'originY', 'originZ', 'axis', 'angle']
    };

    // 回転計算は共通ライブラリ（math/rotation-algorithms.ts）を使用

    /**
     * 構造物を回転させてコピーします
     * 
     * @param args - 回転パラメータ
     * @param args.sourceCorner1X - ソース領域の角点1のX座標
     * @param args.sourceCorner1Y - ソース領域の角点1のY座標
     * @param args.sourceCorner1Z - ソース領域の角点1のZ座標
     * @param args.sourceCorner2X - ソース領域の角点2のX座標
     * @param args.sourceCorner2Y - ソース領域の角点2のY座標
     * @param args.sourceCorner2Z - ソース領域の角点2のZ座標
     * @param args.originX - 回転中心のX座標（回転軸の中心点）
     * @param args.originY - 回転中心のY座標（回転軸の中心点）
     * @param args.originZ - 回転中心のZ座標（回転軸の中心点）
     * @param args.axis - 回転軸（"x": 前後傾き、"y": 水平回転、"z": 左右回転）
     * @param args.angle - 回転角度（度単位、0-360の範囲）
     * @param args.material - 回転後のコピーに使用するブロック素材（デフォルト: "minecraft:stone"）
     * @returns 回転実行結果
     * 
     * @throws 軸が無効な値の場合（x、y、z以外）
     * @throws 角度が範囲外の場合（0-360の範囲外）
     * @throws 座標が有効範囲を超える場合
     * @throws ソース領域が大きすぎる場合（5000ブロック超過）
     * @throws 回転後に配置するブロックがない場合
     * 
     * @example
     * ```typescript
     * // 塔を中心周りに4方向にコピー
     * const angles = [90, 180, 270];
     * for (const angle of angles) {
     *   const result = await tool.execute({
     *     sourceCorner1X: 0, sourceCorner1Y: 64, sourceCorner1Z: 0,
     *     sourceCorner2X: 5, sourceCorner2Y: 80, sourceCorner2Z: 5,
     *     originX: 2, originY: 72, originZ: 2,
     *     axis: "y", angle: angle,
     *     material: "cobblestone"
     *   });
     * }
     * ```
     */
    async execute(args: {
        action?: string;
        sourceCorner1X: number;
        sourceCorner1Y: number;
        sourceCorner1Z: number;
        sourceCorner2X: number;
        sourceCorner2Y: number;
        sourceCorner2Z: number;
        originX: number;
        originY: number;
        originZ: number;
        axis: string;
        angle: number;
        material?: string;
    }): Promise<ToolCallResult> {
        try {
            // Socket-BE API接続確認
            if (!this.world) {
                return { success: false, message: "World not available. Ensure Minecraft is connected." };
            }

            const {
                action = 'build',
                sourceCorner1X, sourceCorner1Y, sourceCorner1Z,
                sourceCorner2X, sourceCorner2Y, sourceCorner2Z,
                originX, originY, originZ,
                axis, angle,
                material = 'minecraft:stone'
            } = args;
            
            // actionパラメータをサポート（現在は build のみ）
            if (action !== 'build') {
                return this.createErrorResponse(`Unknown action: ${action}. Only 'build' is supported.`);
            }

            // 座標の整数化
            const source1 = {
                x: this.normalizeCoordinate(sourceCorner1X),
                y: this.normalizeCoordinate(sourceCorner1Y),
                z: this.normalizeCoordinate(sourceCorner1Z)
            };

            const source2 = {
                x: this.normalizeCoordinate(sourceCorner2X),
                y: this.normalizeCoordinate(sourceCorner2Y),
                z: this.normalizeCoordinate(sourceCorner2Z)
            };

            const origin = {
                x: this.normalizeCoordinate(originX),
                y: this.normalizeCoordinate(originY),
                z: this.normalizeCoordinate(originZ)
            };

            // パラメータ検証
            if (!['x', 'y', 'z'].includes(axis)) {
                return this.createErrorResponse('Axis must be x, y, or z');
            }

            if (angle < 0 || angle > 360) {
                return this.createErrorResponse('Angle must be between 0 and 360 degrees');
            }

            // ソース領域の範囲を計算
            const minX = Math.min(source1.x, source2.x);
            const maxX = Math.max(source1.x, source2.x);
            const minY = Math.min(source1.y, source2.y);
            const maxY = Math.max(source1.y, source2.y);
            const minZ = Math.min(source1.z, source2.z);
            const maxZ = Math.max(source1.z, source2.z);

            // 座標検証
            if (!this.validateCoordinates(minX, minY, minZ) || 
                !this.validateCoordinates(maxX, maxY, maxZ) ||
                !this.validateCoordinates(origin.x, origin.y, origin.z)) {
                return this.createErrorResponse('Coordinates extend beyond valid range');
            }

            // ブロック数の事前チェック
            const totalBlocks = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
            if (totalBlocks > 5000) {
                return this.createErrorResponse('Source region too large (maximum 5000 blocks)');
            }

            // ブロックIDの正規化
            const blockId = this.normalizeBlockId(material);

            const commands: string[] = [];
            let blocksPlaced = 0;
            const placedPositions = new Set<string>();

            // ソース領域の各座標を回転して配置
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        // 座標を回転（共通ライブラリ使用）
                        const rotated = rotatePoint3D(
                            { x, y, z },
                            origin,
                            axis as 'x' | 'y' | 'z',
                            angle
                        );

                        // 回転後の座標が有効範囲内かチェック
                        if (this.validateCoordinates(rotated.x, rotated.y, rotated.z)) {
                            const positionKey = `${rotated.x},${rotated.y},${rotated.z}`;
                            
                            // 重複座標を避ける
                            if (!placedPositions.has(positionKey)) {
                                placedPositions.add(positionKey);
                                commands.push(`setblock ${rotated.x} ${rotated.y} ${rotated.z} ${blockId}`);
                                blocksPlaced++;
                            }
                        }
                    }
                }
            }

            if (commands.length === 0) {
                return this.createErrorResponse('No valid blocks to place after rotation');
            }

            try {
                // Socket-BE APIを使用した実装
                let actualBlocksPlaced = 0;
                
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
                            actualBlocksPlaced++;
                            
                            if (actualBlocksPlaced > BUILD_LIMITS.ROTATE) {
                                return this.createErrorResponse(`Too many blocks to place (maximum ${BUILD_LIMITS.ROTATE.toLocaleString()})`);
                            }
                        }
                    }
                }
                
                return this.createSuccessResponse(
                    `Rotated structure built with ${blockId}. Rotated ${totalBlocks} blocks by ${angle}° around ${axis}-axis at origin (${origin.x},${origin.y},${origin.z}). Placed ${actualBlocksPlaced} blocks.`,
                    {
                        type: 'rotation',
                        sourceRegion: {
                            corner1: source1,
                            corner2: source2
                        },
                        origin: origin,
                        axis: axis,
                        angle: angle,
                        material: blockId,
                        originalBlocks: totalBlocks,
                        blocksPlaced: actualBlocksPlaced,
                        apiUsed: 'Socket-BE'
                    }
                );
            } catch (buildError) {
                return this.createErrorResponse(`Building error: ${buildError instanceof Error ? buildError.message : String(buildError)}`);
            }

        } catch (error) {
            return this.createErrorResponse(
                `Error building rotated structure: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}