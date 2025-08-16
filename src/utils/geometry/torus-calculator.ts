/**
 * トーラス座標計算ライブラリ
 * トーラス構造の座標計算に特化した純粋関数
 */

import { Position } from '../block-optimizer';

/**
 * トーラス座標を計算
 * @param center トーラスの中心座標
 * @param majorRadius 主半径（ドーナツの大きさ）
 * @param minorRadius 副半径（ドーナツの太さ）
 * @param hollow 中空にするかどうか
 * @returns トーラスを構成する座標配列
 */
export function calculateTorusPositions(
  center: Position,
  majorRadius: number,
  minorRadius: number,
  hollow: boolean = false
): Position[] {
  const positions: Position[] = [];
  
  // 分割数を品質重視で調整
  const majorSteps = Math.max(16, Math.round(majorRadius * 6)); // 主円の分割数
  const minorSteps = Math.max(8, Math.round(minorRadius * 8)); // 副円の分割数
  
  for (let i = 0; i < majorSteps; i++) {
    const majorAngle = (2 * Math.PI * i) / majorSteps;
    
    for (let j = 0; j < minorSteps; j++) {
      const minorAngle = (2 * Math.PI * j) / minorSteps;
      
      // 正しいトーラスの数学的定義
      // x = (R + r*cos(v)) * cos(u)
      // y = r * sin(v)  
      // z = (R + r*cos(v)) * sin(u)
      // R = majorRadius, r = minorRadius, u = majorAngle, v = minorAngle
      
      const ringRadius = majorRadius + minorRadius * Math.cos(minorAngle);
      const x = ringRadius * Math.cos(majorAngle);
      const y = minorRadius * Math.sin(minorAngle);
      const z = ringRadius * Math.sin(majorAngle);
      
      // 中空フィルタリング（外側表面のみ）
      if (!hollow || Math.abs(Math.cos(minorAngle)) > 0.6) {
        positions.push({
          x: Math.round(center.x + x),
          y: Math.round(center.y + y),
          z: Math.round(center.z + z)
        });
      }
    }
  }
  
  return positions;
}