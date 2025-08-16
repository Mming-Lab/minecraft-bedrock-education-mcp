/**
 * ベクトル演算ユーティリティ
 * 3D座標系におけるベクトル計算
 */

import { Position } from '../block-optimizer';

/**
 * 座標群の重心を計算
 * @param positions 座標配列
 * @returns 重心座標
 */
export function calculateCentroid(positions: Position[]): Position {
  if (positions.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  
  const sum = positions.reduce(
    (acc, pos) => ({
      x: acc.x + pos.x,
      y: acc.y + pos.y,
      z: acc.z + pos.z
    }),
    { x: 0, y: 0, z: 0 }
  );
  
  return {
    x: Math.round(sum.x / positions.length),
    y: Math.round(sum.y / positions.length),
    z: Math.round(sum.z / positions.length)
  };
}

/**
 * 2点間の距離を計算
 * @param point1 座標1
 * @param point2 座標2
 * @returns 距離
 */
export function calculateDistance(point1: Position, point2: Position): number {
  return Math.sqrt(
    Math.pow(point2.x - point1.x, 2) +
    Math.pow(point2.y - point1.y, 2) +
    Math.pow(point2.z - point1.z, 2)
  );
}

/**
 * ベクトルの正規化
 * @param vector ベクトル
 * @returns 正規化されたベクトル
 */
export function normalizeVector(vector: Position): Position {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}