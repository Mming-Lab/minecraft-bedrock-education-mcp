/**
 * 楕円体座標計算ライブラリ
 * 楕円体構造の座標計算に特化した純粋関数
 */

import { Position } from "../block-optimizer";

/**
 * 楕円体座標を計算
 * @param center 楕円体の中心座標
 * @param radiusX X軸方向の半径
 * @param radiusY Y軸方向の半径
 * @param radiusZ Z軸方向の半径
 * @param hollow 中空にするかどうか
 * @returns 楕円体を構成する座標配列
 */
export function calculateEllipsoidPositions(
  center: Position,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  hollow: boolean = false
): Position[] {
  const positions: Position[] = [];

  const maxRadius = Math.max(radiusX, radiusY, radiusZ);

  for (let x = center.x - maxRadius; x <= center.x + maxRadius; x++) {
    for (let y = center.y - maxRadius; y <= center.y + maxRadius; y++) {
      for (let z = center.z - maxRadius; z <= center.z + maxRadius; z++) {
        const normalizedDistance = Math.sqrt(
          Math.pow((x - center.x) / radiusX, 2) +
            Math.pow((y - center.y) / radiusY, 2) +
            Math.pow((z - center.z) / radiusZ, 2)
        );

        let shouldPlace = false;

        if (hollow) {
          shouldPlace = normalizedDistance <= 1 && normalizedDistance >= 0.8;
        } else {
          shouldPlace = normalizedDistance <= 1;
        }

        if (shouldPlace) {
          positions.push({ x, y, z });
        }
      }
    }
  }

  return positions;
}
