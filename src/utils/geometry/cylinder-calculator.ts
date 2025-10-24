/**
 * 円柱座標計算ライブラリ
 * 円柱構造の座標計算に特化した純粋関数
 */

import { Position } from "../block-optimizer";

/**
 * 円柱座標を計算
 * @param center 円柱の中心座標
 * @param radius 円柱の半径
 * @param height 円柱の高さ
 * @param axis 円柱の軸方向
 * @param hollow 中空にするかどうか
 * @returns 円柱を構成する座標配列
 */
export function calculateCylinderPositions(
  center: Position,
  radius: number,
  height: number,
  axis: "x" | "y" | "z" = "y",
  hollow: boolean = false
): Position[] {
  const positions: Position[] = [];

  for (let i = 0; i < height; i++) {
    const levelPositions = calculateCirclePositions(
      center,
      radius,
      axis,
      i,
      hollow
    );
    positions.push(...levelPositions);
  }

  return positions;
}

/**
 * 円形座標を計算
 * @param center 円の中心座標
 * @param radius 円の半径
 * @param axis 円の面が垂直な軸
 * @param offset 軸方向のオフセット
 * @param hollow 中空にするかどうか
 * @returns 円を構成する座標配列
 */
export function calculateCirclePositions(
  center: Position,
  radius: number,
  axis: "x" | "y" | "z" = "y",
  offset: number = 0,
  hollow: boolean = false
): Position[] {
  const positions: Position[] = [];

  const baseRadius = Math.floor(radius);

  for (let dx = -baseRadius; dx <= baseRadius; dx++) {
    for (let dz = -baseRadius; dz <= baseRadius; dz++) {
      const distance = Math.sqrt(dx * dx + dz * dz);

      let shouldPlace = false;
      if (hollow) {
        shouldPlace = distance <= radius && distance >= radius - 1;
      } else {
        shouldPlace = distance <= radius;
      }

      if (shouldPlace) {
        if (axis === "y") {
          positions.push({
            x: center.x + dx,
            y: center.y + offset,
            z: center.z + dz,
          });
        } else if (axis === "x") {
          positions.push({
            x: center.x + offset,
            y: center.y + dx,
            z: center.z + dz,
          });
        } else if (axis === "z") {
          positions.push({
            x: center.x + dx,
            y: center.y + dz,
            z: center.z + offset,
          });
        }
      }
    }
  }

  return positions;
}
