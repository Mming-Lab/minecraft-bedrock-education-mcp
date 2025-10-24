/**
 * 螺旋座標計算ライブラリ
 * 螺旋構造の座標計算に特化した純粋関数
 */

import { Position } from "../block-optimizer";

/**
 * 螺旋座標を計算（連続性重視）
 * @param start 螺旋の開始座標
 * @param height 螺旋の高さ
 * @param radius 螺旋の半径
 * @param turns 螺旋の回転数
 * @param axis 螺旋の軸方向
 * @returns 螺旋を構成する座標配列
 */
export function calculateHelixPositions(
  start: Position,
  height: number,
  radius: number,
  turns: number,
  axis: "x" | "y" | "z" = "y"
): Position[] {
  const positionSet = new Set<string>();
  const positions: Position[] = [];

  // 螺旋の弧長を基準にした密度計算
  const circumference = 2 * Math.PI * radius;
  const totalArcLength = circumference * turns;
  const helixLength = Math.sqrt(
    totalArcLength * totalArcLength + height * height
  );
  const steps = Math.max(height * 2, Math.round(helixLength)); // 連続性を保つ密度

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const angle = turns * 2 * Math.PI * progress;

    const dx = Math.cos(angle) * radius;
    const dz = Math.sin(angle) * radius;

    let pos: Position;

    if (axis === "y") {
      const y = start.y + height * progress;
      pos = {
        x: Math.round(start.x + dx),
        y: Math.round(y),
        z: Math.round(start.z + dz),
      };
    } else if (axis === "x") {
      const x = start.x + height * progress;
      pos = {
        x: Math.round(x),
        y: Math.round(start.y + dx),
        z: Math.round(start.z + dz),
      };
    } else {
      // axis === 'z'
      const z = start.z + height * progress;
      pos = {
        x: Math.round(start.x + dx),
        y: Math.round(start.y + dz),
        z: Math.round(z),
      };
    }

    // 重複座標を除去（但し連続性は保持）
    const posKey = `${pos.x},${pos.y},${pos.z}`;
    if (!positionSet.has(posKey)) {
      positionSet.add(posKey);
      positions.push(pos);
    }
  }

  return positions;
}
