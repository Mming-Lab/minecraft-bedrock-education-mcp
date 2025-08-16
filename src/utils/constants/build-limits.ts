/**
 * 建築ツール制限値定数
 * 最適化効果を考慮した適切な制限値
 */

/**
 * 最適化前のブロック数制限
 * fillBlocks使用により実際のAPI呼び出し数は大幅に削減される
 */
export const BUILD_LIMITS = {
  // 基本形状（高い最適化効果）
  CUBE: 100000,           // 100K → 1-10 fillBlocks
  SPHERE: 50000,          // 50K → 50-500 fillBlocks  
  CYLINDER: 80000,        // 80K → 20-200 fillBlocks
  ELLIPSOID: 60000,       // 60K → 100-600 fillBlocks
  
  // 複雑形状（中程度最適化効果）
  TORUS: 40000,           // 40K → 200-800 fillBlocks
  HYPERBOLOID: 30000,     // 30K → 100-500 fillBlocks
  PARABOLOID: 30000,      // 30K → 100-500 fillBlocks
  
  // 線形構造（低い最適化効果）
  HELIX: 20000,           // 20K → 5000-15000 fillBlocks（線形のため）
  LINE: 10000,            // 10K → 5000-8000 fillBlocks（線形のため）
  
  // 特殊操作
  ROTATE: 50000,          // 50K → 元構造に依存
  TRANSFORM: 50000        // 50K → 元構造に依存
} as const;

/**
 * 最適化後のfillBlocks操作数制限
 * Socket-BE APIの実際の負荷制限
 */
export const FILLBLOCKS_LIMITS = {
  MAX_OPERATIONS: 2000,   // 最大fillBlocks呼び出し数
  SAFETY_MARGIN: 0.8      // 安全マージン（80%使用で制限）
} as const;

/**
 * ツール別の推奨制限値計算
 */
export function getRecommendedLimit(toolType: keyof typeof BUILD_LIMITS): number {
  return BUILD_LIMITS[toolType];
}

/**
 * 最適化効果予測に基づく制限チェック
 */
export function estimateOptimizationRatio(toolType: keyof typeof BUILD_LIMITS, blockCount: number): number {
  // ツール別の平均圧縮率
  const compressionRatios = {
    CUBE: 0.99,         // 99%削減
    SPHERE: 0.90,       // 90%削減
    CYLINDER: 0.95,     // 95%削減
    ELLIPSOID: 0.85,    // 85%削減
    TORUS: 0.80,        // 80%削減
    HYPERBOLOID: 0.75,  // 75%削減
    PARABOLOID: 0.75,   // 75%削減
    HELIX: 0.20,        // 20%削減（線形構造）
    LINE: 0.30,         // 30%削減（線形構造）
    ROTATE: 0.70,       // 70%削減（平均）
    TRANSFORM: 0.70     // 70%削減（平均）
  };
  
  const ratio = compressionRatios[toolType] || 0.5;
  return blockCount * (1 - ratio); // 削減後の予想操作数
}