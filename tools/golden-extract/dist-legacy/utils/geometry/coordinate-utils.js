"use strict";
/**
 * 座標計算の統一ユーティリティ
 * makecode-minecraft-geometry-ext の設計を参考に
 * 座標の検証、正規化、距離計算などの共通処理を提供
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOLLOW_THRESHOLD = exports.MATH_CONSTANTS = exports.WORLD_BOUNDS = void 0;
exports.normalizeCoordinate = normalizeCoordinate;
exports.normalizeX = normalizeX;
exports.normalizeY = normalizeY;
exports.normalizeZ = normalizeZ;
exports.validateCoordinates = validateCoordinates;
exports.validateYCoordinate = validateYCoordinate;
exports.getCoordinateValidationError = getCoordinateValidationError;
exports.calculateDistance = calculateDistance;
exports.distanceBetween = distanceBetween;
exports.calculateNormalizedDistance = calculateNormalizedDistance;
exports.shouldPlaceBlock = shouldPlaceBlock;
exports.roundPosition = roundPosition;
exports.removeDuplicatePositions = removeDuplicatePositions;
exports.calculateBoundingBox = calculateBoundingBox;
exports.validateBoundingBox = validateBoundingBox;
exports.lerp = lerp;
exports.lerp3D = lerp3D;
exports.bernsteinBasis = bernsteinBasis;
const building_messages_1 = require("../i18n/building-messages");
/**
 * Minecraft ワールドの座標境界定数
 */
exports.WORLD_BOUNDS = {
    X_MIN: -30000000,
    X_MAX: 30000000,
    Y_MIN: -64,
    Y_MAX: 320,
    Z_MIN: -30000000,
    Z_MAX: 30000000,
};
/**
 * 数学定数
 */
exports.MATH_CONSTANTS = {
    PI: Math.PI,
    TWO_PI: 2 * Math.PI,
    HALF_PI: Math.PI / 2,
    SQRT_2: Math.sqrt(2),
    SQRT_3: Math.sqrt(3),
};
/**
 * 座標を有効範囲内に正規化
 */
function normalizeCoordinate(coord, min, max) {
    const normalized = Math.round(coord);
    return Math.max(min, Math.min(max, normalized));
}
/**
 * X座標の正規化
 */
function normalizeX(x) {
    return normalizeCoordinate(x, exports.WORLD_BOUNDS.X_MIN, exports.WORLD_BOUNDS.X_MAX);
}
/**
 * Y座標の正規化
 */
function normalizeY(y) {
    return normalizeCoordinate(y, exports.WORLD_BOUNDS.Y_MIN, exports.WORLD_BOUNDS.Y_MAX);
}
/**
 * Z座標の正規化
 */
function normalizeZ(z) {
    return normalizeCoordinate(z, exports.WORLD_BOUNDS.Z_MIN, exports.WORLD_BOUNDS.Z_MAX);
}
/**
 * 座標が有効範囲内かを検証
 */
function validateCoordinates(x, y, z) {
    return (x >= exports.WORLD_BOUNDS.X_MIN &&
        x <= exports.WORLD_BOUNDS.X_MAX &&
        y >= exports.WORLD_BOUNDS.Y_MIN &&
        y <= exports.WORLD_BOUNDS.Y_MAX &&
        z >= exports.WORLD_BOUNDS.Z_MIN &&
        z <= exports.WORLD_BOUNDS.Z_MAX);
}
/**
 * Y座標が有効範囲内かを検証
 */
function validateYCoordinate(y) {
    return y >= exports.WORLD_BOUNDS.Y_MIN && y <= exports.WORLD_BOUNDS.Y_MAX;
}
/**
 * 座標検証の詳細なエラーメッセージを生成
 */
function getCoordinateValidationError(x, y, z) {
    if (x < exports.WORLD_BOUNDS.X_MIN || x > exports.WORLD_BOUNDS.X_MAX) {
        return (0, building_messages_1.getCoordinateValidationMessage)("X_OUT_OF_RANGE", x);
    }
    if (y < exports.WORLD_BOUNDS.Y_MIN || y > exports.WORLD_BOUNDS.Y_MAX) {
        return (0, building_messages_1.getCoordinateValidationMessage)("Y_OUT_OF_RANGE", y);
    }
    if (z < exports.WORLD_BOUNDS.Z_MIN || z > exports.WORLD_BOUNDS.Z_MAX) {
        return (0, building_messages_1.getCoordinateValidationMessage)("Z_OUT_OF_RANGE", z);
    }
    return null;
}
/**
 * 3D空間のユークリッド距離を計算
 */
function calculateDistance(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
/**
 * 2点間の距離を計算（Position型）
 */
function distanceBetween(p1, p2) {
    return calculateDistance(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
}
/**
 * 正規化距離を計算（楕円体用）
 * 各軸の半径で割った距離
 */
function calculateNormalizedDistance(x, y, z, centerX, centerY, centerZ, radiusX, radiusY, radiusZ) {
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
function shouldPlaceBlock(distance, radius, hollow) {
    if (hollow) {
        // 中空の場合は外側1層のみ
        return distance <= radius && distance >= Math.max(0, radius - 1);
    }
    else {
        // 実体の場合は半径内すべて
        return distance <= radius;
    }
}
/**
 * 中空形状検出の閾値
 */
exports.HOLLOW_THRESHOLD = 0.8;
/**
 * 座標を整数に丸める
 */
function roundPosition(x, y, z) {
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
function removeDuplicatePositions(positions) {
    const seen = new Set();
    const unique = [];
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
function calculateBoundingBox(positions) {
    if (positions.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    }
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
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
function validateBoundingBox(bbox) {
    return (validateCoordinates(bbox.minX, bbox.minY, bbox.minZ) &&
        validateCoordinates(bbox.maxX, bbox.maxY, bbox.maxZ));
}
/**
 * 線形補間（lerp）
 */
function lerp(start, end, t) {
    return start + (end - start) * t;
}
/**
 * 3D線形補間
 */
function lerp3D(start, end, t) {
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
function bernsteinBasis(i, n, t) {
    const binomialCoeff = factorial(n) / (factorial(i) * factorial(n - i));
    return binomialCoeff * Math.pow(t, i) * Math.pow(1 - t, n - i);
}
/**
 * 階乗計算（小さな数値のみ対応）
 */
function factorial(n) {
    if (n <= 1)
        return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}
