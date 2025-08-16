/**
 * 線分座標計算ライブラリ
 * 線分構造の座標計算に特化した純粋関数（3Dブレゼンハムアルゴリズム）
 */

import { Position } from '../block-optimizer';

/**
 * 線分座標を計算（3Dブレゼンハムアルゴリズム）
 * @param start 線分の開始座標
 * @param end 線分の終了座標
 * @returns 線分を構成する座標配列
 */
export function calculateLinePositions(
  start: Position,
  end: Position
): Position[] {
  const positions: Position[] = [];
  
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const dz = Math.abs(end.z - start.z);
  
  const sx = start.x < end.x ? 1 : -1;
  const sy = start.y < end.y ? 1 : -1;
  const sz = start.z < end.z ? 1 : -1;
  
  let errXY = dx - dy;
  let errXZ = dx - dz;
  let errYZ = dy - dz;
  
  let x = start.x;
  let y = start.y;
  let z = start.z;
  
  while (true) {
    positions.push({ x, y, z });
    
    if (x === end.x && y === end.y && z === end.z) break;
    
    const e2XY = 2 * errXY;
    const e2XZ = 2 * errXZ;
    const e2YZ = 2 * errYZ;
    
    if (e2XY > -dy && e2XZ > -dz) {
      errXY -= dy;
      errXZ -= dz;
      x += sx;
    }
    if (e2XY < dx && e2YZ > -dz) {
      errXY += dx;
      errYZ -= dz;
      y += sy;
    }
    if (e2XZ < dx && e2YZ < dy) {
      errXZ += dx;
      errYZ += dy;
      z += sz;
    }
  }
  
  return positions;
}