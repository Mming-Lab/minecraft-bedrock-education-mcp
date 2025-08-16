/**
 * 回転変換統合処理
 * 複数回転とプリセット方向指定を統合処理
 */

import { Position } from '../block-optimizer';
import { rotatePointsArray } from '../math/rotation-algorithms';
import { calculateCentroid } from '../math/vector-utils';

export interface RotationParams {
  axis: 'x' | 'y' | 'z';
  angle: number; // 度数
  origin: Position; // 回転中心
}

export interface DirectionalParams {
  direction?: '+x' | '+y' | '+z' | '-x' | '-y' | '-z' | 'custom';
  rotations?: RotationParams[]; // 複数回転（オイラー角対応）
}

/**
 * 複数回転を座標群に順次適用（オイラー角対応）
 * @param positions 座標配列
 * @param rotations 回転パラメータ配列
 * @returns 回転後の座標配列
 */
export function applyMultipleRotations(
  positions: Position[],
  rotations: RotationParams[]
): Position[] {
  let result = [...positions];
  
  for (const rotation of rotations) {
    result = rotatePointsArray(result, rotation.origin, rotation.axis, rotation.angle);
  }
  
  return result;
}

/**
 * 方向指定から回転パラメータを生成
 * @param direction 方向指定
 * @param origin 回転中心
 * @returns 回転パラメータ配列
 */
export function getRotationsFromDirection(
  direction: string,
  origin: Position
): RotationParams[] {
  const directions: Record<string, RotationParams[]> = {
    '+x': [{ axis: 'z', angle: -90, origin }], // Y軸構造をX軸方向に
    '-x': [{ axis: 'z', angle: 90, origin }],
    '+y': [], // デフォルト（回転なし）
    '-y': [{ axis: 'z', angle: 180, origin }],
    '+z': [{ axis: 'x', angle: 90, origin }], // Y軸構造をZ軸方向に
    '-z': [{ axis: 'x', angle: -90, origin }]
  };
  
  return directions[direction] || [];
}

/**
 * 方向指定または複数回転を座標群に適用
 * @param positions 座標配列
 * @param params 方向パラメータ
 * @returns 変換結果
 */
export function applyDirectionalTransform(
  positions: Position[],
  params: DirectionalParams
): { 
  positions: Position[]; 
  transformInfo: string; 
} {
  if (positions.length === 0) {
    return { positions, transformInfo: '' };
  }
  
  // 回転中心を計算（重心）
  const origin = calculateCentroid(positions);
  
  let rotations: RotationParams[] = [];
  let transformInfo = '';
  
  if (params.direction && params.direction !== '+y') {
    // プリセット方向指定
    if (params.direction === 'custom' && params.rotations) {
      rotations = params.rotations;
      transformInfo = `custom rotations (${rotations.length} steps)`;
    } else {
      rotations = getRotationsFromDirection(params.direction, origin);
      transformInfo = `oriented to ${params.direction}`;
    }
  } else if (params.rotations) {
    // 直接回転指定
    rotations = params.rotations;
    transformInfo = `custom rotations (${rotations.length} steps)`;
  }
  
  if (rotations.length === 0) {
    return { positions, transformInfo: '' };
  }
  
  const transformedPositions = applyMultipleRotations(positions, rotations);
  
  return { 
    positions: transformedPositions, 
    transformInfo: transformInfo ? ` (${transformInfo})` : ''
  };
}

/**
 * プリセット回転パターン
 */
export const PRESET_ORIENTATIONS = {
  // 基本軸方向
  POSITIVE_X: [{ axis: 'z' as const, angle: -90 }],
  NEGATIVE_X: [{ axis: 'z' as const, angle: 90 }],
  POSITIVE_Y: [], // デフォルト
  NEGATIVE_Y: [{ axis: 'z' as const, angle: 180 }],
  POSITIVE_Z: [{ axis: 'x' as const, angle: 90 }],
  NEGATIVE_Z: [{ axis: 'x' as const, angle: -90 }],
  
  // 斜め方向（45度傾斜）
  DIAGONAL_XY_45: [
    { axis: 'z' as const, angle: 45 }
  ],
  DIAGONAL_XZ_45: [
    { axis: 'y' as const, angle: 45 }
  ],
  DIAGONAL_YZ_45: [
    { axis: 'x' as const, angle: 45 }
  ],
  
  // 複雑な姿勢（3軸回転）
  TILTED_TOWER: [
    { axis: 'x' as const, angle: 15 }, // 前後に傾ける
    { axis: 'y' as const, angle: 30 }, // 左右に向ける
    { axis: 'z' as const, angle: 10 }  // ひねる
  ],
  DIAGONAL_SPIRAL: [
    { axis: 'x' as const, angle: 30 },
    { axis: 'y' as const, angle: 45 },
    { axis: 'z' as const, angle: 15 }
  ],
  EXTREME_ANGLE: [
    { axis: 'x' as const, angle: 60 },
    { axis: 'y' as const, angle: 45 },
    { axis: 'z' as const, angle: 30 }
  ]
} as const;

/**
 * プリセットを使用した座標変換
 * @param positions 座標配列
 * @param presetName プリセット名
 * @param origin 回転中心（省略時は重心）
 * @returns 変換結果
 */
export function applyPresetOrientation(
  positions: Position[],
  presetName: keyof typeof PRESET_ORIENTATIONS,
  origin?: Position
): { positions: Position[]; transformInfo: string } {
  if (positions.length === 0) {
    return { positions, transformInfo: '' };
  }
  
  const rotationOrigin = origin || calculateCentroid(positions);
  const rotationTemplates = PRESET_ORIENTATIONS[presetName];
  
  const rotations: RotationParams[] = rotationTemplates.map(template => ({
    ...template,
    origin: rotationOrigin
  }));
  
  const transformedPositions = applyMultipleRotations(positions, rotations);
  
  return {
    positions: transformedPositions,
    transformInfo: ` (preset: ${presetName}, ${rotations.length} rotations)`
  };
}