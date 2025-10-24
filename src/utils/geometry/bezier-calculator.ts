/**
 * ベジェ曲線座標計算ユーティリティ
 * makecode-minecraft-geometry-ext の可変制御点ベジェ曲線を参考に実装
 */

import {
  bernsteinBasis,
  calculateDistance,
  removeDuplicatePositions,
} from "./coordinate-utils";

export interface Position {
  x: number;
  y: number;
  z: number;
}

/**
 * ベジェ曲線の座標を計算（可変制御点対応）
 *
 * @param startPoint 開始点
 * @param endPoint 終了点
 * @param controlPoints 制御点配列（1個以上）
 * @param segments セグメント数（デフォルト: 50）
 * @returns 座標配列
 *
 * @example
 * ```typescript
 * // 3次ベジェ曲線（制御点2個）
 * const positions = calculateBezierPositions(
 *   { x: 0, y: 70, z: 0 },
 *   { x: 60, y: 70, z: 30 },
 *   [{ x: 20, y: 85, z: 10 }, { x: 40, y: 60, z: 20 }],
 *   100
 * );
 *
 * // 2次ベジェ曲線（制御点1個）
 * const simplePositions = calculateBezierPositions(
 *   { x: 0, y: 70, z: 0 },
 *   { x: 30, y: 70, z: 30 },
 *   [{ x: 15, y: 90, z: 15 }],
 *   50
 * );
 * ```
 */
export function calculateBezierPositions(
  startPoint: Position,
  endPoint: Position,
  controlPoints: Position[],
  segments: number = 50
): Position[] {
  if (controlPoints.length === 0) {
    // 制御点がない場合は直線
    return calculateLinearPath(startPoint, endPoint, segments);
  }

  // 全ての点を配列にまとめる
  const allPoints = [startPoint, ...controlPoints, endPoint];
  const n = allPoints.length - 1; // ベジェ曲線の次数

  const positions: Position[] = [];
  let lastX = -Infinity;
  let lastY = -Infinity;
  let lastZ = -Infinity;

  // t パラメータを 0 から 1 まで変化させる
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let x = 0;
    let y = 0;
    let z = 0;

    // ベルンシュタイン基底多項式を使用してベジェ曲線を計算
    for (let j = 0; j <= n; j++) {
      const basis = bernsteinBasis(j, n, t);
      x += allPoints[j].x * basis;
      y += allPoints[j].y * basis;
      z += allPoints[j].z * basis;
    }

    // 整数座標に丸める
    const roundedX = Math.floor(x);
    const roundedY = Math.floor(y);
    const roundedZ = Math.floor(z);

    // 重複を避ける
    if (roundedX !== lastX || roundedY !== lastY || roundedZ !== lastZ) {
      positions.push({ x: roundedX, y: roundedY, z: roundedZ });
      lastX = roundedX;
      lastY = roundedY;
      lastZ = roundedZ;
    }
  }

  return positions;
}

/**
 * 直線経路を計算
 */
function calculateLinearPath(
  start: Position,
  end: Position,
  segments: number
): Position[] {
  const positions: Position[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    positions.push({
      x: Math.floor(start.x + (end.x - start.x) * t),
      y: Math.floor(start.y + (end.y - start.y) * t),
      z: Math.floor(start.z + (end.z - start.z) * t),
    });
  }

  return removeDuplicatePositions(positions);
}

/**
 * ベジェ曲線の弧長を推定（適応的セグメント数計算用）
 *
 * @param startPoint 開始点
 * @param endPoint 終了点
 * @param controlPoints 制御点配列
 * @param samplePoints サンプル点数（デフォルト: 100）
 * @returns 推定弧長
 */
export function estimateBezierArcLength(
  startPoint: Position,
  endPoint: Position,
  controlPoints: Position[],
  samplePoints: number = 100
): number {
  const allPoints = [startPoint, ...controlPoints, endPoint];
  const n = allPoints.length - 1;

  let totalLength = 0;
  let prevPoint: Position | null = null;

  for (let i = 0; i <= samplePoints; i++) {
    const t = i / samplePoints;
    let x = 0;
    let y = 0;
    let z = 0;

    for (let j = 0; j <= n; j++) {
      const basis = bernsteinBasis(j, n, t);
      x += allPoints[j].x * basis;
      y += allPoints[j].y * basis;
      z += allPoints[j].z * basis;
    }

    const currentPoint = { x, y, z };

    if (prevPoint !== null) {
      totalLength += calculateDistance(
        prevPoint.x,
        prevPoint.y,
        prevPoint.z,
        currentPoint.x,
        currentPoint.y,
        currentPoint.z
      );
    }

    prevPoint = currentPoint;
  }

  return totalLength;
}

/**
 * 適応的セグメント数を計算
 * 弧長に基づいて適切なセグメント数を自動決定
 *
 * @param startPoint 開始点
 * @param endPoint 終了点
 * @param controlPoints 制御点配列
 * @param blocksPerUnit 1単位あたりのブロック数（デフォルト: 1）
 * @returns 推奨セグメント数
 */
export function calculateAdaptiveSegments(
  startPoint: Position,
  endPoint: Position,
  controlPoints: Position[],
  blocksPerUnit: number = 1
): number {
  const arcLength = estimateBezierArcLength(
    startPoint,
    endPoint,
    controlPoints
  );
  const segments = Math.ceil(arcLength * blocksPerUnit);

  // 最小50、最大1000の範囲で制限
  return Math.max(50, Math.min(1000, segments));
}

/**
 * 3次ベジェ曲線（制御点2個の簡易版）
 *
 * @param start 開始点
 * @param end 終了点
 * @param control1 制御点1
 * @param control2 制御点2
 * @param segments セグメント数
 * @returns 座標配列
 */
export function calculateCubicBezier(
  start: Position,
  end: Position,
  control1: Position,
  control2: Position,
  segments: number = 50
): Position[] {
  return calculateBezierPositions(start, end, [control1, control2], segments);
}

/**
 * 2次ベジェ曲線（制御点1個の簡易版）
 *
 * @param start 開始点
 * @param end 終了点
 * @param control 制御点
 * @param segments セグメント数
 * @returns 座標配列
 */
export function calculateQuadraticBezier(
  start: Position,
  end: Position,
  control: Position,
  segments: number = 50
): Position[] {
  return calculateBezierPositions(start, end, [control], segments);
}
