import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';

/**
 * 構造物変形・複製ツール
 * 
 * @description
 * 指定された領域の構造物をコピー、回転、鏡像、スケール変換します。
 * 建物の複製、鏡像コピー、サイズ変更などの構造物変換操作に最適で、
 * 各種の幾何学的変換（コピー、回転、鏡像、スケール）をサポートします。
 * 
 * @extends BaseTool
 * 
 * @example
 * ```typescript
 * const tool = new BuildTransformTool();
 * 
 * // 家をコピー
 * await tool.execute({
 *   sourceCorner1X: 0, sourceCorner1Y: 64, sourceCorner1Z: 0,
 *   sourceCorner2X: 10, sourceCorner2Y: 70, sourceCorner2Z: 10,
 *   targetX: 20, targetY: 64, targetZ: 0,
 *   transformation: "copy"
 * });
 * 
 * // 塔をX軸で鏡像反転してコピー
 * await tool.execute({
 *   sourceCorner1X: 0, sourceCorner1Y: 64, sourceCorner1Z: 0,
 *   sourceCorner2X: 5, sourceCorner2Y: 80, sourceCorner2Z: 5,
 *   targetX: 10, targetY: 64, targetZ: 0,
 *   transformation: "mirror_x",
 *   material: "cobblestone"
 * });
 * ```
 * 
 * @since 1.0.0
 * @author mcbk-mcp contributors
 */
export class BuildTransformTool extends BaseTool {
    readonly name = 'build_transform';
    readonly description = 'Transform structures by copying, rotating, mirroring, or scaling. Perfect for duplicating buildings, creating mirror images, or making scaled versions. Popular options: copy=duplicate, mirror_x=flip horizontally, scale_up=make 2x bigger';
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
            targetX: {
                type: 'number',
                description: 'Target location X coordinate'
            },
            targetY: {
                type: 'number',
                description: 'Target location Y coordinate'
            },
            targetZ: {
                type: 'number',
                description: 'Target location Z coordinate'
            },
            transformation: {
                type: 'string',
                description: 'Transformation type: copy=exact duplicate, rotate_90/180/270=turn horizontally, mirror_x=flip east-west, mirror_y=flip up-down, mirror_z=flip north-south, scale_up=double size, scale_down=half size',
                enum: ['copy', 'rotate_90', 'rotate_180', 'rotate_270', 'mirror_x', 'mirror_y', 'mirror_z', 'scale_up', 'scale_down']
            },
            material: {
                type: 'string',
                description: 'Block type for the transformed structure (leave empty to copy original blocks, or specify material like stone, wood, etc.)',
                default: ''
            }
        },
        required: ['sourceCorner1X', 'sourceCorner1Y', 'sourceCorner1Z', 'sourceCorner2X', 'sourceCorner2Y', 'sourceCorner2Z', 'targetX', 'targetY', 'targetZ', 'transformation']
    };

    /**
     * 座標を指定された変形に従って変換する
     */
    private transformCoordinate(
        x: number, y: number, z: number,
        transformation: string,
        sourceWidth: number, sourceHeight: number, sourceDepth: number
    ): { x: number, y: number, z: number } {
        switch (transformation) {
            case 'copy':
                return { x, y, z };
            
            case 'rotate_90':
                // Y軸周りに90度回転 (X,Z平面)
                return { x: -z, y, z: x };
            
            case 'rotate_180':
                // Y軸周りに180度回転
                return { x: -x, y, z: -z };
            
            case 'rotate_270':
                // Y軸周りに270度回転
                return { x: z, y, z: -x };
            
            case 'mirror_x':
                // X軸に対して鏡像
                return { x: sourceWidth - 1 - x, y, z };
            
            case 'mirror_y':
                // Y軸に対して鏡像
                return { x, y: sourceHeight - 1 - y, z };
            
            case 'mirror_z':
                // Z軸に対して鏡像
                return { x, y, z: sourceDepth - 1 - z };
            
            case 'scale_up':
                // 2倍スケール
                return { x: x * 2, y: y * 2, z: z * 2 };
            
            case 'scale_down':
                // 1/2スケール
                return { x: Math.floor(x / 2), y: Math.floor(y / 2), z: Math.floor(z / 2) };
            
            default:
                return { x, y, z };
        }
    }

    /**
     * 構造物を変形・複製します
     * 
     * @param args - 変形パラメータ
     * @param args.sourceCorner1X - ソース領域の角点1のX座標
     * @param args.sourceCorner1Y - ソース領域の角点1のY座標
     * @param args.sourceCorner1Z - ソース領域の角点1のZ座標
     * @param args.sourceCorner2X - ソース領域の角点2のX座標
     * @param args.sourceCorner2Y - ソース領域の角点2のY座標
     * @param args.sourceCorner2Z - ソース領域の角点2のZ座標
     * @param args.targetX - ターゲット位置のX座標
     * @param args.targetY - ターゲット位置のY座標
     * @param args.targetZ - ターゲット位置のZ座標
     * @param args.transformation - 変形タイプ（copy, rotate_90/180/270, mirror_x/y/z, scale_up/down）
     * @param args.material - 変形後の構造物に使用するブロック素材（空文字の場合は元のブロックをコピー）
     * @returns 変形実行結果
     * 
     * @throws 変形タイプが無効な値の場合
     * @throws 座標が有効範囲を超える場合
     * @throws 変形後の構造物が大きすぎる場合（10000ブロック超過）
     * @throws 変形後に配置するブロックがない場合
     * @throws 簡単コピー以外で素材が指定されていない場合
     * 
     * @example
     * ```typescript
     * // 建物をスケールアップしてコピー
     * const result = await tool.execute({
     *   sourceCorner1X: 0, sourceCorner1Y: 64, sourceCorner1Z: 0,
     *   sourceCorner2X: 5, sourceCorner2Y: 70, sourceCorner2Z: 5,
     *   targetX: 20, targetY: 64, targetZ: 20,
     *   transformation: "scale_up",
     *   material: "stone_bricks"
     * });
     * 
     * if (result.success) {
     *   console.log(`変形完了: ${result.data.blocksPlaced}ブロック配置`);
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
        targetX: number;
        targetY: number;
        targetZ: number;
        transformation: string;
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
                targetX, targetY, targetZ,
                transformation,
                material = ''
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

            const target = {
                x: this.normalizeCoordinate(targetX),
                y: this.normalizeCoordinate(targetY),
                z: this.normalizeCoordinate(targetZ)
            };

            // パラメータ検証
            const validTransformations = ['copy', 'rotate_90', 'rotate_180', 'rotate_270', 'mirror_x', 'mirror_y', 'mirror_z', 'scale_up', 'scale_down'];
            if (!validTransformations.includes(transformation)) {
                return this.createErrorResponse('Invalid transformation type');
            }

            // ソース領域の範囲を計算
            const minX = Math.min(source1.x, source2.x);
            const maxX = Math.max(source1.x, source2.x);
            const minY = Math.min(source1.y, source2.y);
            const maxY = Math.max(source1.y, source2.y);
            const minZ = Math.min(source1.z, source2.z);
            const maxZ = Math.max(source1.z, source2.z);

            const sourceWidth = maxX - minX + 1;
            const sourceHeight = maxY - minY + 1;
            const sourceDepth = maxZ - minZ + 1;

            // 座標検証
            if (!this.validateCoordinates(minX, minY, minZ) || 
                !this.validateCoordinates(maxX, maxY, maxZ) ||
                !this.validateCoordinates(target.x, target.y, target.z)) {
                return this.createErrorResponse('Coordinates extend beyond valid range');
            }

            // ブロック数の事前チェック
            let totalBlocks = sourceWidth * sourceHeight * sourceDepth;
            if (transformation === 'scale_up') {
                totalBlocks *= 8; // 2倍スケールなので8倍のブロック数
            }
            
            if (totalBlocks > 10000) {
                return this.createErrorResponse('Structure too large after transformation (maximum 10000 blocks)');
            }

            const commands: string[] = [];
            let blocksPlaced = 0;
            const placedPositions = new Set<string>();

            // 材料が指定されている場合
            if (material && material.trim() !== '') {
                const blockId = this.normalizeBlockId(material);

                // ソース領域の各座標を変形して配置
                for (let x = 0; x < sourceWidth; x++) {
                    for (let y = 0; y < sourceHeight; y++) {
                        for (let z = 0; z < sourceDepth; z++) {
                            // 座標を変形
                            const transformed = this.transformCoordinate(
                                x, y, z, transformation, 
                                sourceWidth, sourceHeight, sourceDepth
                            );

                            // ターゲット位置に配置
                            const finalX = target.x + transformed.x;
                            const finalY = target.y + transformed.y;
                            const finalZ = target.z + transformed.z;

                            // 座標が有効範囲内かチェック
                            if (this.validateCoordinates(finalX, finalY, finalZ)) {
                                const positionKey = `${finalX},${finalY},${finalZ}`;
                                
                                if (!placedPositions.has(positionKey)) {
                                    placedPositions.add(positionKey);
                                    commands.push(`setblock ${finalX} ${finalY} ${finalZ} ${blockId}`);
                                    blocksPlaced++;
                                }
                            }
                        }
                    }
                }
            } else {
                // 材料が指定されていない場合はcloneコマンドを使用（Minecraft Bedrock Editionの場合）
                if (transformation === 'copy') {
                    // 単純なコピーの場合
                    commands.push(`clone ${minX} ${minY} ${minZ} ${maxX} ${maxY} ${maxZ} ${target.x} ${target.y} ${target.z}`);
                    blocksPlaced = totalBlocks;
                } else {
                    return this.createErrorResponse('Material must be specified for transformations other than simple copy');
                }
            }

            if (commands.length === 0) {
                return this.createErrorResponse('No valid blocks to place after transformation');
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
                            
                            if (actualBlocksPlaced > 5000) {
                                return this.createErrorResponse('Too many blocks to place (maximum 5000)');
                            }
                        }
                    } else if (command.startsWith('clone ')) {
                        // cloneコマンドはSocket-BE APIではサポートされていないため、コマンドで実行
                        await this.executeCommand(command);
                        actualBlocksPlaced = blocksPlaced; // 予想値を使用
                    }
                }
                
                const materialInfo = material && material.trim() !== '' ? ` with ${this.normalizeBlockId(material)}` : '';
                return this.createSuccessResponse(
                    `Structure transformed using ${transformation}${materialInfo}. Processed ${totalBlocks} original blocks, placed ${actualBlocksPlaced} blocks at target (${target.x},${target.y},${target.z}).`,
                    {
                        type: 'transformation',
                        sourceRegion: {
                            corner1: source1,
                            corner2: source2,
                            dimensions: { width: sourceWidth, height: sourceHeight, depth: sourceDepth }
                        },
                        target: target,
                        transformation: transformation,
                        material: material ? this.normalizeBlockId(material) : null,
                        originalBlocks: totalBlocks,
                        blocksPlaced: actualBlocksPlaced,
                        apiUsed: 'Socket-BE + Command'
                    }
                );
            } catch (buildError) {
                return this.createErrorResponse(`Building error: ${buildError instanceof Error ? buildError.message : String(buildError)}`);
            }

        } catch (error) {
            return this.createErrorResponse(
                `Error transforming structure: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}