/**
 * 立方体座標計算ライブラリ
 * 立方体構造の座標計算に特化した純粋関数
 */

import { Position } from "../block-optimizer";

/**
 * 立方体座標を計算
 * @param corner1 立方体の角点1
 * @param corner2 立方体の角点2
 * @param hollow 中空にするかどうか
 * @returns 立方体を構成する座標配列
 */
export function calculateCubePositions(
  corner1: Position,
  corner2: Position,
  hollow: boolean = false
): Position[] {
  const positions: Position[] = [];

  // 座標を正規化（最小値と最大値を決定）
  const minX = Math.min(corner1.x, corner2.x);
  const maxX = Math.max(corner1.x, corner2.x);
  const minY = Math.min(corner1.y, corner2.y);
  const maxY = Math.max(corner1.y, corner2.y);
  const minZ = Math.min(corner1.z, corner2.z);
  const maxZ = Math.max(corner1.z, corner2.z);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        let shouldPlace = false;

        if (hollow) {
          // 中空立方体：外壁のみ（6面のいずれかが外側面）
          const isOnBoundary =
            x === minX ||
            x === maxX ||
            y === minY ||
            y === maxY ||
            z === minZ ||
            z === maxZ;
          shouldPlace = isOnBoundary;
        } else {
          // 実体立方体：すべての座標
          shouldPlace = true;
        }

        if (shouldPlace) {
          positions.push({ x, y, z });
        }
      }
    }
  }

  return positions;
}
