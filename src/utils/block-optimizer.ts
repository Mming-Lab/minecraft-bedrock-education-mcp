/**
 * ブロック座標最適化ライブラリ
 * fillBlocks使用による高速化のため、座標群を最小数の直方体に分解
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
 * 座標群を最小数の直方体に分解（Greedy アルゴリズム）
 * Socket-BE APIのfillBlocks使用により大幅な高速化を実現
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

  // 座標をソートしてグリッド化
  const xs = [...new Set(positions.map(p => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(positions.map(p => p.y))].sort((a, b) => a - b);
  const zs = [...new Set(positions.map(p => p.z))].sort((a, b) => a - b);
  
  // ブロック存在チェック用Set
  const blocks = new Set(positions.map(p => `${p.x},${p.y},${p.z}`));
  const rectangles: Rectangle[] = [];
  
  // 大きな直方体から貪欲に検索
  for (let x1 = 0; x1 < xs.length; x1++) {
    for (let y1 = 0; y1 < ys.length; y1++) {
      for (let z1 = 0; z1 < zs.length; z1++) {
        // 開始点がまだ残っているかチェック
        const startKey = `${xs[x1]},${ys[y1]},${zs[z1]}`;
        if (!blocks.has(startKey)) continue;
        
        // このポイントから最大の直方体を探す
        let maxX = x1, maxY = y1, maxZ = z1;
        
        // X方向に拡張
        for (let x2 = x1; x2 < xs.length; x2++) {
          let canExpand = true;
          for (let y = y1; y <= maxY; y++) {
            for (let z = z1; z <= maxZ; z++) {
              if (!blocks.has(`${xs[x2]},${ys[y]},${zs[z]}`)) {
                canExpand = false;
                break;
              }
            }
            if (!canExpand) break;
          }
          if (canExpand) maxX = x2;
          else break;
        }
        
        // Y方向に拡張
        for (let y2 = y1; y2 < ys.length; y2++) {
          let canExpand = true;
          for (let x = x1; x <= maxX; x++) {
            for (let z = z1; z <= maxZ; z++) {
              if (!blocks.has(`${xs[x]},${ys[y2]},${zs[z]}`)) {
                canExpand = false;
                break;
              }
            }
            if (!canExpand) break;
          }
          if (canExpand) maxY = y2;
          else break;
        }
        
        // Z方向に拡張
        for (let z2 = z1; z2 < zs.length; z2++) {
          let canExpand = true;
          for (let x = x1; x <= maxX; x++) {
            for (let y = y1; y <= maxY; y++) {
              if (!blocks.has(`${xs[x]},${ys[y]},${zs[z2]}`)) {
                canExpand = false;
                break;
              }
            }
            if (!canExpand) break;
          }
          if (canExpand) maxZ = z2;
          else break;
        }
        
        // 直方体を作成
        const rect: Rectangle = {
          from: { x: xs[x1], y: ys[y1], z: zs[z1] },
          to: { x: xs[maxX], y: ys[maxY], z: zs[maxZ] }
        };
        rectangles.push(rect);
        
        // 使用したブロックを削除
        for (let x = x1; x <= maxX; x++) {
          for (let y = y1; y <= maxY; y++) {
            for (let z = z1; z <= maxZ; z++) {
              blocks.delete(`${xs[x]},${ys[y]},${zs[z]}`);
            }
          }
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
  
  if (result.compressionRatio >= 10) {
    return `高効率最適化: ${result.compressionRatio.toFixed(1)}x圧縮 (${result.fillOperationCount}回のfillBlocks操作)`;
  } else if (result.compressionRatio >= 2) {
    return `最適化: ${result.compressionRatio.toFixed(2)}x圧縮 (${result.fillOperationCount}回のfillBlocks操作)`;
  } else {
    return `線形構造のため圧縮率${result.compressionRatio.toFixed(2)}x（個別配置）`;
  }
}