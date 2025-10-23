/**
 * 座標計算の統一ユーティリティ
 * makecode-minecraft-geometry-ext の設計を参考に
 * 座標の検証、正規化、距離計算などの共通処理を提供
 */

import { COORDINATE_VALIDATION } from '../constants/building-messages';

/**
 * Minecraft ワールドの座標境界定数
 */
export const WORLD_BOUNDS = {
  X_MIN: -30000000,
  X_MAX: 30000000,
  Y_MIN: -64,
  Y_MAX: 320,
  Z_MIN: -30000000,
  Z_MAX: 30000000,
} as const;

/**
 * 数学定数
 */
export const MATH_CONSTANTS = {
  PI: Math.PI,
  TWO_PI: 2 * Math.PI,
  HALF_PI: Math.PI / 2,
  SQRT_2: Math.sqrt(2),
  SQRT_3: Math.sqrt(3),
} as const;

/**
 * 座標を有効範囲内に正規化
 */
export function normalizeCoordinate(coord: number, min: number, max: number): number {
  const normalized = Math.round(coord);
  return Math.max(min, Math.min(max, normalized));
}

/**
 * X座標の正規化
 */
export function normalizeX(x: number): number {
  return normalizeCoordinate(x, WORLD_BOUNDS.X_MIN, WORLD_BOUNDS.X_MAX);
}

/**
 * Y座標の正規化
 */
export function normalizeY(y: number): number {
  return normalizeCoordinate(y, WORLD_BOUNDS.Y_MIN, WORLD_BOUNDS.Y_MAX);
}

/**
 * Z座標の正規化
 */
export function normalizeZ(z: number): number {
  return normalizeCoordinate(z, WORLD_BOUNDS.Z_MIN, WORLD_BOUNDS.Z_MAX);
}

/**
 * 座標が有効範囲内かを検証
 */
export function validateCoordinates(x: number, y: number, z: number): boolean {
  return (
    x >= WORLD_BOUNDS.X_MIN &&
    x <= WORLD_BOUNDS.X_MAX &&
    y >= WORLD_BOUNDS.Y_MIN &&
    y <= WORLD_BOUNDS.Y_MAX &&
    z >= WORLD_BOUNDS.Z_MIN &&
    z <= WORLD_BOUNDS.Z_MAX
  );
}

/**
 * Y座標が有効範囲内かを検証
 */
export function validateYCoordinate(y: number): boolean {
  return y >= WORLD_BOUNDS.Y_MIN && y <= WORLD_BOUNDS.Y_MAX;
}

/**
 * 座標検証の詳細なエラーメッセージを生成
 */
export function getCoordinateValidationError(x: number, y: number, z: number): string | null {
  if (x < WORLD_BOUNDS.X_MIN || x > WORLD_BOUNDS.X_MAX) {
    return COORDINATE_VALIDATION.X_OUT_OF_RANGE(x);
  }
  if (y < WORLD_BOUNDS.Y_MIN || y > WORLD_BOUNDS.Y_MAX) {
    return COORDINATE_VALIDATION.Y_OUT_OF_RANGE(y);
  }
  if (z < WORLD_BOUNDS.Z_MIN || z > WORLD_BOUNDS.Z_MAX) {
    return COORDINATE_VALIDATION.Z_OUT_OF_RANGE(z);
  }
  return null;
}

/**
 * 3D空間のユークリッド距離を計算
 */
export function calculateDistance(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 2点間の距離を計算（Position型）
 */
export function distanceBetween(p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }): number {
  return calculateDistance(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
}

/**
 * 正規化距離を計算（楕円体用）
 * 各軸の半径で割った距離
 */
export function calculateNormalizedDistance(
  x: number,
  y: number,
  z: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  radiusX: number,
  radiusY: number,
  radiusZ: number
): number {
  const dx = (x - centerX) / radiusX;
  const dy = (y - centerY) / radiusY;
  const dz = (z - centerZ) / radiusZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * ブロック配置判定（球形/中空検出）
 * @param distance 中心からの距離
 * @param radius 半径
 * @param hollow 中空フラグ
 */
export function shouldPlaceBlock(distance: number, radius: number, hollow: boolean): boolean {
  if (hollow) {
    // 中空の場合は外側1層のみ
    return distance <= radius && distance >= Math.max(0, radius - 1);
  } else {
    // 実体の場合は半径内すべて
    return distance <= radius;
  }
}

/**
 * 中空形状検出の閾値
 */
export const HOLLOW_THRESHOLD = 0.8;

/**
 * 座標を整数に丸める
 */
export function roundPosition(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
  };
}

/**
 * 座標配列の重複を除去
 * MakeCode互換の方法でユニーク化
 */
export function removeDuplicatePositions(positions: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] {
  const seen = new Set<string>();
  const unique: { x: number; y: number; z: number }[] = [];

  for (const pos of positions) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(pos);
    }
  }

  return unique;
}

/**
 * 座標配列の境界ボックスを計算
 */
export function calculateBoundingBox(positions: { x: number; y: number; z: number }[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  if (positions.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }

  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;

  for (const pos of positions) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y);
    minZ = Math.min(minZ, pos.z);
    maxZ = Math.max(maxZ, pos.z);
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * 境界ボックスが有効な座標範囲内かを検証
 */
export function validateBoundingBox(bbox: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}): boolean {
  return (
    validateCoordinates(bbox.minX, bbox.minY, bbox.minZ) &&
    validateCoordinates(bbox.maxX, bbox.maxY, bbox.maxZ)
  );
}

/**
 * 線形補間（lerp）
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * 3D線形補間
 */
export function lerp3D(
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  t: number
): { x: number; y: number; z: number } {
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
    z: lerp(start.z, end.z, t),
  };
}

/**
 * ベルンシュタイン基底多項式を計算（ベジェ曲線用）
 * @param i インデックス
 * @param n 次数
 * @param t パラメータ（0-1）
 */
export function bernsteinBasis(i: number, n: number, t: number): number {
  const binomialCoeff = factorial(n) / (factorial(i) * factorial(n - i));
  return binomialCoeff * Math.pow(t, i) * Math.pow(1 - t, n - i);
}

/**
 * 階乗計算（小さな数値のみ対応）
 */
function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}
