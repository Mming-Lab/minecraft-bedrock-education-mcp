"use strict";
/**
 * 放物面座標計算ライブラリ
 * 放物面構造の座標計算に特化した純粋関数
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateParaboloidPositions = calculateParaboloidPositions;
const cylinder_calculator_1 = require("./cylinder-calculator");
/**
 * 放物面座標を計算
 * @param center 放物面の中心座標
 * @param radius 放物面の最大半径
 * @param height 放物面の高さ
 * @param direction 放物面の方向（上向きまたは下向き）
 * @param hollow 中空にするかどうか
 * @returns 放物面を構成する座標配列
 */
function calculateParaboloidPositions(center, radius, height, direction = 'up', hollow = false) {
    const positions = [];
    const steps = height;
    for (let i = 0; i < steps; i++) {
        const progress = i / (steps - 1);
        const y = direction === 'up' ? i : height - 1 - i;
        const currentRadius = radius * Math.sqrt(progress);
        if (currentRadius > 0) {
            const circlePositions = (0, cylinder_calculator_1.calculateCirclePositions)({ x: center.x, y: center.y + y, z: center.z }, currentRadius, 'y', 0, hollow);
            positions.push(...circlePositions);
        }
    }
    return positions;
}
