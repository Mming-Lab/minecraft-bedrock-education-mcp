/**
 * 建築ツール最適化適用ユーティリティ（レガシー）
 * 新しいアーキテクチャへの移行のため、integration/build-executor.tsを使用することを推奨
 * @deprecated Use integration/build-executor.ts instead
 */

import { optimizeBlocks, getOptimizationStats, Position } from './block-optimizer';
import { applyDirectionalTransform, DirectionalParams } from './integration/rotation-transformer';

// 座標計算関数は geometry/ に移動されました
import {
  calculateSpherePositions,
  calculateCylinderPositions, 
  calculateCirclePositions,
  calculateEllipsoidPositions,
  calculateHelixPositions,
  calculateTorusPositions,
  calculateParaboloidPositions,
  calculateHyperboloidPositions,
  calculateLinePositions
} from './geometry';

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
 * @deprecated Use integration/build-executor.ts executeBuildWithOptimization() instead
 */
export async function executeBuildWithOptimization(
  world: any,
  positions: Position[],
  blockId: string,
  additionalData: Record<string, any> = {},
  directionalParams?: DirectionalParams
): Promise<OptimizedBuildResult> {
  // 新しいアーキテクチャに移行
  const { executeBuildWithOptimization: newExecutor } = await import('./integration/build-executor');
  return newExecutor(world, positions, blockId, additionalData, directionalParams);
}

// この関数は geometry/sphere-calculator.ts に移動されました
// 後方互換性のためのエクスポート
export { calculateSpherePositions } from './geometry';

// これらの関数は geometry/cylinder-calculator.ts に移動されました
export { calculateCylinderPositions, calculateCirclePositions } from './geometry';

// この関数は geometry/ellipsoid-calculator.ts に移動されました
export { calculateEllipsoidPositions } from './geometry';

// この関数は geometry/helix-calculator.ts に移動されました
export { calculateHelixPositions } from './geometry';

// この関数は geometry/torus-calculator.ts に移動されました
export { calculateTorusPositions } from './geometry';

// この関数は geometry/hyperboloid-calculator.ts に移動されました
export { calculateHyperboloidPositions } from './geometry';

// この関数は geometry/paraboloid-calculator.ts に移動されました
export { calculateParaboloidPositions } from './geometry';

// この関数は geometry/line-calculator.ts に移動されました
export { calculateLinePositions } from './geometry';