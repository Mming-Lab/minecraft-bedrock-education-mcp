/**
 * 球体座標計算ライブラリ
 * 球体構造の座標計算に特化した純粋関数
 */

import { Position } from '../block-optimizer';

/**
 * 球体座標を計算
 * @param center 球体の中心座標
 * @param radius 球体の半径
 * @param hollow 中空にするかどうか
 * @returns 球体を構成する座標配列
 */
export function calculateSpherePositions(
  center: Position,
  radius: number,
  hollow: boolean = false
): Position[] {
  const positions: Position[] = [];
  
  for (let x = center.x - radius; x <= center.x + radius; x++) {
    for (let y = center.y - radius; y <= center.y + radius; y++) {
      for (let z = center.z - radius; z <= center.z + radius; z++) {
        const distance = Math.sqrt(
          Math.pow(x - center.x, 2) + 
          Math.pow(y - center.y, 2) + 
          Math.pow(z - center.z, 2)
        );
        
        let shouldPlace = false;
        
        if (hollow) {
          // 中空の球体：表面のみ
          shouldPlace = distance <= radius && distance >= radius - 1;
        } else {
          // 実体の球体：内部も含む
          shouldPlace = distance <= radius;
        }
        
        if (shouldPlace) {
          positions.push({x, y, z});
        }
      }
    }
  }
  
  return positions;
}