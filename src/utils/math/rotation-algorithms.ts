/**
 * 3D回転計算アルゴリズム
 * ロドリゲスの回転公式による正確な3D回転計算
 */

import { Position } from "../block-optimizer";

/**
 * 単一の3D座標を指定軸周りに回転させる（ロドリゲスの回転公式）
 * @param point 回転させる座標
 * @param origin 回転中心座標
 * @param axis 回転軸
 * @param angleDegrees 回転角度（度）
 * @returns 回転後の座標
 */
export function rotatePoint3D(
  point: { x: number; y: number; z: number },
  origin: { x: number; y: number; z: number },
  axis: "x" | "y" | "z",
  angleDegrees: number
): { x: number; y: number; z: number } {
  // 回転軸を表す単位ベクトル
  const n = [0, 0, 0];
  if (axis === "x") {
    n[0] = 1;
  } else if (axis === "y") {
    n[1] = 1;
  } else if (axis === "z") {
    n[2] = 1;
  }

  // 角度をラジアンに変換
  const radians = angleDegrees * (Math.PI / 180);

  // 回転行列（ロドリゲスの回転公式）
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const c1 = 1 - cos;

  const R = [
    [
      c1 * (n[0] * n[0]) + cos,
      c1 * (n[0] * n[1]) - n[2] * sin,
      c1 * (n[0] * n[2]) + n[1] * sin,
    ],
    [
      c1 * (n[0] * n[1]) + n[2] * sin,
      c1 * (n[1] * n[1]) + cos,
      c1 * (n[1] * n[2]) - n[0] * sin,
    ],
    [
      c1 * (n[0] * n[2]) - n[1] * sin,
      c1 * (n[1] * n[2]) + n[0] * sin,
      c1 * (n[2] * n[2]) + cos,
    ],
  ];

  // 座標を相対座標に変換
  const relativeX = point.x - origin.x;
  const relativeY = point.y - origin.y;
  const relativeZ = point.z - origin.z;

  // 相対座標に回転行列を適用
  const rotatedX =
    R[0][0] * relativeX + R[0][1] * relativeY + R[0][2] * relativeZ;
  const rotatedY =
    R[1][0] * relativeX + R[1][1] * relativeY + R[1][2] * relativeZ;
  const rotatedZ =
    R[2][0] * relativeX + R[2][1] * relativeY + R[2][2] * relativeZ;

  // 絶対座標に変換して返す
  return {
    x: Math.round(origin.x + rotatedX),
    y: Math.round(origin.y + rotatedY),
    z: Math.round(origin.z + rotatedZ),
  };
}

/**
 * 座標配列を指定軸周りに回転させる
 * @param points 回転させる座標配列
 * @param origin 回転中心座標
 * @param axis 回転軸
 * @param angleDegrees 回転角度（度）
 * @returns 回転後の座標配列
 */
export function rotatePointsArray(
  points: Position[],
  origin: Position,
  axis: "x" | "y" | "z",
  angleDegrees: number
): Position[] {
  return points.map((point) =>
    rotatePoint3D(point, origin, axis, angleDegrees)
  );
}
