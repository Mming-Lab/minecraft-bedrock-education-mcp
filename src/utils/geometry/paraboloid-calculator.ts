/**
 * 放物面座標計算ライブラリ
 * 放物面構造の座標計算に特化した純粋関数
 */

import { Position } from '../block-optimizer';
import { calculateCirclePositions } from './cylinder-calculator';

/**
 * 放物面座標を計算
 * @param center 放物面の中心座標
 * @param radius 放物面の最大半径
 * @param height 放物面の高さ
 * @param direction 放物面の方向（上向きまたは下向き）
 * @param hollow 中空にするかどうか
 * @returns 放物面を構成する座標配列
 */
export function calculateParaboloidPositions(
  center: Position,
  radius: number,
  height: number,
  direction: 'up' | 'down' = 'up',
  hollow: boolean = false
): Position[] {
  const positions: Position[] = [];
  
  const steps = height;
  for (let i = 0; i < steps; i++) {
    const progress = i / (steps - 1);
    const y = direction === 'up' ? i : height - 1 - i;
    const currentRadius = radius * Math.sqrt(progress);
    
    if (currentRadius > 0) {
      const circlePositions = calculateCirclePositions(
        { x: center.x, y: center.y + y, z: center.z },
        currentRadius,
        'y',
        0,
        hollow
      );
      
      positions.push(...circlePositions);
    }
  }
  
  return positions;
}