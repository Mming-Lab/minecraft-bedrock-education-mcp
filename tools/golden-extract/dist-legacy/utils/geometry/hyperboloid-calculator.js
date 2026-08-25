"use strict";
/**
 * 双曲面座標計算ライブラリ
 * 双曲面構造の座標計算に特化した純粋関数
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateHyperboloidPositions = calculateHyperboloidPositions;
const cylinder_calculator_1 = require("./cylinder-calculator");
/**
 * 双曲面座標を計算
 * @param center 双曲面の中心座標
 * @param radius 双曲面の基準半径
 * @param height 双曲面の高さ
 * @param waist 双曲面のくびれ係数（0.1-1.0）
 * @param hollow 中空にするかどうか
 * @returns 双曲面を構成する座標配列
 */
function calculateHyperboloidPositions(center, radius, height, waist = 0.5, hollow = false) {
    const positions = [];
    const steps = height;
    for (let i = 0; i < steps; i++) {
        const y = i - height / 2;
        const normalizedY = y / (height / 2);
        const currentRadius = radius * Math.sqrt(waist * waist + normalizedY * normalizedY);
        const circlePositions = (0, cylinder_calculator_1.calculateCirclePositions)({ x: center.x, y: center.y + y, z: center.z }, currentRadius, "y", 0, hollow);
        positions.push(...circlePositions);
    }
    return positions;
}
