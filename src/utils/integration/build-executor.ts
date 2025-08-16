/**
 * 建築実行統合処理
 * 座標最適化と回転を統合したブロック配置実行
 */

import { optimizeBlocks, getOptimizationStats, Position } from '../block-optimizer';
import { applyDirectionalTransform, DirectionalParams } from './rotation-transformer';

export interface OptimizedBuildResult {
  success: boolean;
  message: string;
  data?: {
    blocksPlaced: number;
    optimization: {
      fillOperations: number;
      compressionRatio: number;
      stats: string;
    };
    [key: string]: any;
  };
}

/**
 * 座標配列をfillBlocksで最適配置する共通関数（回転対応）
 * @param world Socket-BE APIのworldインスタンス
 * @param positions 配置する座標配列
 * @param blockId ブロックID
 * @param additionalData 追加データ
 * @param directionalParams 回転パラメータ
 * @returns 建築実行結果
 */
export async function executeBuildWithOptimization(
  world: any,
  positions: Position[],
  blockId: string,
  additionalData: Record<string, any> = {},
  directionalParams?: DirectionalParams
): Promise<OptimizedBuildResult> {
  try {
    if (positions.length === 0) {
      return {
        success: false,
        message: 'No blocks to place'
      };
    }

    // 方向指定がある場合は回転を適用
    let finalPositions = positions;
    let transformInfo = '';
    
    if (directionalParams) {
      const result = applyDirectionalTransform(positions, directionalParams);
      finalPositions = result.positions;
      transformInfo = result.transformInfo;
    }

    // ブロック配置の最適化
    const optimization = optimizeBlocks(finalPositions);
    
    // 最適化された直方体でfillBlocks実行
    for (const rect of optimization.rectangles) {
      // 1x1x1の場合はsetBlockを使用
      if (rect.from.x === rect.to.x && rect.from.y === rect.to.y && rect.from.z === rect.to.z) {
        await world.setBlock(rect.from, blockId);
      } else {
        await world.fillBlocks(rect.from, rect.to, blockId);
      }
    }
    
    const blocksPlaced = optimization.originalBlockCount;

    return {
      success: true,
      message: `Structure built with ${blockId}${transformInfo}. Placed ${blocksPlaced} blocks with ${optimization.fillOperationCount} fillBlocks operations (${optimization.compressionRatio.toFixed(2)}x compression).`,
      data: {
        blocksPlaced,
        optimization: {
          fillOperations: optimization.fillOperationCount,
          compressionRatio: optimization.compressionRatio,
          stats: getOptimizationStats(optimization)
        },
        ...additionalData
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Building error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}