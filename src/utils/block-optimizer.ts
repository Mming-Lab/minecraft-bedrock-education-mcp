/**
 * ブロック配置最適化ユーティリティ
 * 座標群を最小数の直方体で表現してfillBlocks呼び出しを削減
 */

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface Rectangle {
  from: Position;
  to: Position;
}

export interface OptimizationResult {
  rectangles: Rectangle[];
  originalBlockCount: number;
  fillOperationCount: number;
  compressionRatio: number;
}

/**
 * 座標群を最小数の直方体で表現する（貪欲法）
 */
export function optimizeBlocks(positions: Position[]): OptimizationResult {
  if (positions.length === 0) {
    return {
      rectangles: [],
      originalBlockCount: 0,
      fillOperationCount: 0,
      compressionRatio: 1
    };
  }

  const blocks = new Set(positions.map(p => `${p.x},${p.y},${p.z}`));
  const rectangles: Rectangle[] = [];
  
  while (blocks.size > 0) {
    // 残りブロックから任意の点を開始点とする
    const startStr = blocks.values().next().value!;
    const [sx, sy, sz] = startStr.split(',').map(Number);
    
    // X軸方向に最大まで拡張
    let maxX = sx;
    while (blocks.has(`${maxX + 1},${sy},${sz}`)) {
      maxX++;
    }
    
    // Y軸方向に最大まで拡張
    let maxY = sy;
    let canExtendY = true;
    while (canExtendY) {
      for (let x = sx; x <= maxX; x++) {
        if (!blocks.has(`${x},${maxY + 1},${sz}`)) {
          canExtendY = false;
          break;
        }
      }
      if (canExtendY) maxY++;
    }
    
    // Z軸方向に最大まで拡張
    let maxZ = sz;
    let canExtendZ = true;
    while (canExtendZ) {
      for (let x = sx; x <= maxX; x++) {
        for (let y = sy; y <= maxY; y++) {
          if (!blocks.has(`${x},${y},${maxZ + 1}`)) {
            canExtendZ = false;
            break;
          }
        }
        if (!canExtendZ) break;
      }
      if (canExtendZ) maxZ++;
    }
    
    // 直方体を追加
    rectangles.push({
      from: { x: sx, y: sy, z: sz },
      to: { x: maxX, y: maxY, z: maxZ }
    });
    
    // 該当ブロックを削除
    for (let x = sx; x <= maxX; x++) {
      for (let y = sy; y <= maxY; y++) {
        for (let z = sz; z <= maxZ; z++) {
          blocks.delete(`${x},${y},${z}`);
        }
      }
    }
  }
  
  const originalCount = positions.length;
  const fillCount = rectangles.length;
  
  return {
    rectangles,
    originalBlockCount: originalCount,
    fillOperationCount: fillCount,
    compressionRatio: originalCount / fillCount
  };
}

/**
 * 高度な最適化（動的プログラミング法）
 * より最適解に近いが計算コストが高い
 */
export function optimizeBlocksAdvanced(positions: Position[], coverageThreshold = 0.7): OptimizationResult {
  if (positions.length === 0) {
    return {
      rectangles: [],
      originalBlockCount: 0,
      fillOperationCount: 0,
      compressionRatio: 1
    };
  }

  // 座標をソートしてバウンディングボックスを計算
  const xs = [...new Set(positions.map(p => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(positions.map(p => p.y))].sort((a, b) => a - b);
  const zs = [...new Set(positions.map(p => p.z))].sort((a, b) => a - b);
  
  const blocks = new Set(positions.map(p => `${p.x},${p.y},${p.z}`));
  const rectangles: Rectangle[] = [];
  
  // 大きな直方体から優先的に処理
  const candidates: Array<{rect: Rectangle, coverage: CoverageResult}> = [];
  
  for (let x1 = 0; x1 < xs.length; x1++) {
    for (let y1 = 0; y1 < ys.length; y1++) {
      for (let z1 = 0; z1 < zs.length; z1++) {
        for (let x2 = x1; x2 < xs.length; x2++) {
          for (let y2 = y1; y2 < ys.length; y2++) {
            for (let z2 = z1; z2 < zs.length; z2++) {
              const rect: Rectangle = {
                from: { x: xs[x1], y: ys[y1], z: zs[z1] },
                to: { x: xs[x2], y: ys[y2], z: zs[z2] }
              };
              
              const coverage = calculateCoverage(rect, blocks);
              
              if (coverage.ratio >= coverageThreshold) {
                candidates.push({ rect, coverage });
              }
            }
          }
        }
      }
    }
  }
  
  // カバレッジ効率の高い順にソート
  candidates.sort((a, b) => {
    const efficiencyA = a.coverage.covered.length / a.coverage.total;
    const efficiencyB = b.coverage.covered.length / b.coverage.total;
    return efficiencyB - efficiencyA;
  });
  
  // 貪欲に選択
  for (const candidate of candidates) {
    const currentCoverage = calculateCoverage(candidate.rect, blocks);
    if (currentCoverage.ratio >= coverageThreshold) {
      rectangles.push(candidate.rect);
      
      // カバーしたブロックを削除
      for (const pos of currentCoverage.covered) {
        blocks.delete(pos);
      }
    }
  }
  
  // 残りのブロックを個別処理
  while (blocks.size > 0) {
    const startStr = blocks.values().next().value!;
    const [x, y, z] = startStr.split(',').map(Number);
    rectangles.push({
      from: { x, y, z },
      to: { x, y, z }
    });
    blocks.delete(startStr);
  }
  
  const originalCount = positions.length;
  const fillCount = rectangles.length;
  
  return {
    rectangles,
    originalBlockCount: originalCount,
    fillOperationCount: fillCount,
    compressionRatio: originalCount / fillCount
  };
}

interface CoverageResult {
  covered: string[];
  total: number;
  ratio: number;
}

function calculateCoverage(rect: Rectangle, blocks: Set<string>): CoverageResult {
  const covered: string[] = [];
  let total = 0;
  
  for (let x = rect.from.x; x <= rect.to.x; x++) {
    for (let y = rect.from.y; y <= rect.to.y; y++) {
      for (let z = rect.from.z; z <= rect.to.z; z++) {
        total++;
        const key = `${x},${y},${z}`;
        if (blocks.has(key)) {
          covered.push(key);
        }
      }
    }
  }
  
  return {
    covered,
    total,
    ratio: covered.length / total
  };
}

/**
 * 直方体の体積を計算
 */
export function calculateVolume(rect: Rectangle): number {
  return (rect.to.x - rect.from.x + 1) * 
         (rect.to.y - rect.from.y + 1) * 
         (rect.to.z - rect.from.z + 1);
}

/**
 * 最適化結果の統計情報を出力
 */
export function getOptimizationStats(result: OptimizationResult): string {
  const totalVolume = result.rectangles.reduce((sum, rect) => sum + calculateVolume(rect), 0);
  
  return `最適化結果:
- 元のブロック数: ${result.originalBlockCount}
- fillBlocks呼び出し数: ${result.fillOperationCount}
- 圧縮率: ${result.compressionRatio.toFixed(2)}x
- 削減率: ${((1 - 1/result.compressionRatio) * 100).toFixed(1)}%
- 総体積: ${totalVolume}`;
}