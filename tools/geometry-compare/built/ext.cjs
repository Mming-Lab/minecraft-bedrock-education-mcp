// Minimal stand-ins for the MakeCode Minecraft API so `src/coordinates.ts` can be compiled
// and executed outside the editor. Behaviour matches what the coordinate functions rely on:
// a Position is an immutable (x, y, z) triple, and everything else is inert.
var Axis;
(function (Axis) {
    Axis[Axis["X"] = 0] = "X";
    Axis[Axis["Y"] = 1] = "Y";
    Axis[Axis["Z"] = 2] = "Z";
})(Axis || (Axis = {}));
var FillOperation;
(function (FillOperation) {
    FillOperation[FillOperation["Replace"] = 0] = "Replace";
    FillOperation[FillOperation["Hollow"] = 1] = "Hollow";
    FillOperation[FillOperation["Outline"] = 2] = "Outline";
    FillOperation[FillOperation["Destroy"] = 3] = "Destroy";
    FillOperation[FillOperation["Keep"] = 4] = "Keep";
})(FillOperation || (FillOperation = {}));
class Position {
    constructor(_x, _y, _z) {
        this._x = _x;
        this._y = _y;
        this._z = _z;
    }
    getValue(axis) {
        if (axis === Axis.X)
            return this._x;
        if (axis === Axis.Y)
            return this._y;
        return this._z;
    }
    toString() {
        return `(${this._x}, ${this._y}, ${this._z})`;
    }
}
function world(x, y, z) {
    return new Position(x, y, z);
}
function pos(x, y, z) {
    return new Position(x, y, z);
}
var player;
(function (player) {
    /** No-op: progress chatter is irrelevant outside the game and would flood the console. */
    function say(_message) { }
    player.say = say;
})(player || (player = {}));
var positions;
(function (positions) {
    function equals(a, b) {
        return (a.getValue(Axis.X) === b.getValue(Axis.X) &&
            a.getValue(Axis.Y) === b.getValue(Axis.Y) &&
            a.getValue(Axis.Z) === b.getValue(Axis.Z));
    }
    positions.equals = equals;
    function add(a, b) {
        return new Position(a.getValue(Axis.X) + b.getValue(Axis.X), a.getValue(Axis.Y) + b.getValue(Axis.Y), a.getValue(Axis.Z) + b.getValue(Axis.Z));
    }
    positions.add = add;
})(positions || (positions = {}));
var blocks;
(function (blocks) {
    blocks.placed = [];
    blocks.filled = [];
    function place(_block, position) {
        blocks.placed.push(position);
    }
    blocks.place = place;
    function fill(_block, from, to, _op) {
        blocks.filled.push({ from, to });
    }
    blocks.fill = fill;
})(blocks || (blocks = {}));
var loops;
(function (loops) {
    /** No-op: the harness has no game tick to yield to. */
    function pause(_ms) { }
    loops.pause = pause;
})(loops || (loops = {}));
// 座標計算名前空間（ブロック配置せずに座標配列を返す）
//% block="座標" weight=2 color=#4CAF50 icon="\uf43c" advanced=true
var coordinates;
(function (coordinates) {
    // ==============================
    // 設定定数とメッセージ定義
    // ==============================
    /** Minecraft座標の有効範囲 */
    const WORLD_BOUNDS = {
        X_MIN: -30000000, X_MAX: 30000000,
        Y_MIN: -64, Y_MAX: 320,
        Z_MIN: -30000000, Z_MAX: 30000000
    };
    /** すべてのステータスメッセージ（日本語） */
    coordinates.MESSAGES = {
        GENERATING: "生成中...",
        ERROR_INVALID_CENTER: "エラー: 無効な中心位置",
        ERROR_INVALID_RADIUS: "エラー: 半径は正の値である必要があります",
        PLACEMENT_START: "配置を開始しました",
        PLACEMENT_COMPLETE: "配置が完了しました",
        BATCH_PROCESSING: "バッチ処理中"
    };
    /** 数学定数 */
    const MATH_CONSTANTS = {
        PI: 3.14159,
        TWO_PI: 2 * 3.14159
    };
    /** プログレス報告定数 */
    const PROGRESS_INTERVAL_COUNT = 1000;
    /** BlockExistenceChecker用の位置エンコーディング定数 */
    const ENCODING_CONSTANTS = {
        X_MULTIPLIER: 1000000,
        Y_MULTIPLIER: 1000,
        Z_MULTIPLIER: 1
    };
    /** 中空形状検出の閾値 */
    const HOLLOW_THRESHOLD = 0.8;
    // ==============================
    // 座標ユーティリティ関数
    // ==============================
    function normalizeCoordinate(coord) {
        const normalized = Math.round(coord);
        return Math.max(WORLD_BOUNDS.X_MIN, Math.min(WORLD_BOUNDS.X_MAX, normalized));
    }
    function validateCoordinates(x, y, z) {
        return x >= WORLD_BOUNDS.X_MIN && x <= WORLD_BOUNDS.X_MAX &&
            y >= WORLD_BOUNDS.Y_MIN && y <= WORLD_BOUNDS.Y_MAX &&
            z >= WORLD_BOUNDS.Z_MIN && z <= WORLD_BOUNDS.Z_MAX;
    }
    function safeWorld(x, y, z) {
        const normalizedX = normalizeCoordinate(x);
        const normalizedY = normalizeCoordinate(y);
        const normalizedZ = normalizeCoordinate(z);
        if (validateCoordinates(normalizedX, normalizedY, normalizedZ)) {
            return world(normalizedX, normalizedY, normalizedZ);
        }
        return null;
    }
    /**
     * 3D空間のユークリッド距離を計算
     * @param x1 点1のX座標
     * @param y1 点1のY座標
     * @param z1 点1のZ座標
     * @param x2 点2のX座標
     * @param y2 点2のY座標
     * @param z2 点2のZ座標
     * @returns 2点間のユークリッド距離
     */
    function calculateDistance(x1, y1, z1, x2, y2, z2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    /**
     * ブロック配置判定の共通ロジック（球形/中空検出）
     * @param distance 中心からの距離
     * @param radius 半径の値
     * @param hollow 中空フラグ
     * @returns ブロックを配置すべきかどうか
     */
    function shouldPlaceBlock(distance, radius, hollow) {
        if (hollow) {
            return distance <= radius && distance >= Math.max(0, radius - 1);
        }
        else {
            return distance <= radius;
        }
    }
    /**
     * 密度サンプリング判定
     * @param densityFactor 密度係数（0.1-1.0）
     * @returns 密度サンプリングに基づいてブロックを配置すべきかどうか
     */
    function passesDensitySampling(densityFactor) {
        if (densityFactor <= 0)
            return false;
        return densityFactor >= 1.0 || Math.random() < densityFactor;
    }
    /**
     * カウント付きプログレスメッセージを取得
     * @param count 現在生成された座標の数
     * @returns カウント付きプログレスメッセージ文字列
     */
    function getProgressMessage(count) {
        return `${coordinates.MESSAGES.GENERATING} (${count})`;
    }
    /**
     * 可変制御点を持つベジェ曲線の座標を計算
     */
    //% weight=8
    //% blockId=minecraftGetVariableBezierCurvePositions
    //% block="可変ベジェ曲線の座標を取得 開始 $startPoint 終了 $endPoint 制御点配列 $controlPoints"
    //% blockExternalInputs=1
    //% startPoint.shadow=minecraftCreateWorldInternal
    //% endPoint.shadow=minecraftCreateWorldInternal
    //% group="曲線"
    function getVariableBezierCurvePositions(startPoint, controlPoints, endPoint) {
        const allControlPoints = [startPoint];
        for (let i = 0; i < controlPoints.length; i++) {
            allControlPoints.push(controlPoints[i]);
        }
        allControlPoints.push(endPoint);
        const n = allControlPoints.length - 1;
        const positionsArr = [];
        function binomialCoeff(n, k) {
            if (k > n)
                return 0;
            if (k === 0 || k === n)
                return 1;
            let result = 1;
            for (let i = 0; i < k; i++) {
                result = result * (n - i) / (i + 1);
            }
            return result;
        }
        function bezierCalculation(t) {
            let x = 0, y = 0, z = 0;
            for (let i = 0; i <= n; i++) {
                const coeff = binomialCoeff(n, i) * Math.pow(1 - t, n - i) * Math.pow(t, i);
                x += coeff * allControlPoints[i].getValue(Axis.X);
                y += coeff * allControlPoints[i].getValue(Axis.Y);
                z += coeff * allControlPoints[i].getValue(Axis.Z);
            }
            return world(Math.round(x), Math.round(y), Math.round(z));
        }
        let previousPos = bezierCalculation(0);
        positionsArr.push(previousPos);
        let t = 0;
        const stepSize = 0.01;
        while (t < 1.0) {
            t += stepSize;
            if (t > 1.0)
                t = 1.0;
            const nextPos = bezierCalculation(t);
            if (previousPos && !positions.equals(previousPos, nextPos)) {
                positionsArr.push(nextPos);
                if (positionsArr.length % PROGRESS_INTERVAL_COUNT === 0) {
                    player.say(getProgressMessage(positionsArr.length));
                }
                previousPos = nextPos;
            }
            if (t >= 1.0)
                break;
        }
        return positionsArr;
    }
    coordinates.getVariableBezierCurvePositions = getVariableBezierCurvePositions;
    /**
     * 最適化された円の座標計算
     */
    function getCirclePositionsOptimized(center, radius, axis, offset = 0, hollow = false) {
        const positions = [];
        const centerX = Math.round(center.getValue(Axis.X));
        const centerY = Math.round(center.getValue(Axis.Y));
        const centerZ = Math.round(center.getValue(Axis.Z));
        const radiusInt = Math.round(radius);
        const radiusSquared = radiusInt * radiusInt;
        const innerRadius = hollow ? Math.max(0, radiusInt - 1) : 0;
        const innerRadiusSquared = innerRadius * innerRadius;
        // 効率的な円生成アルゴリズム
        for (let dx = -radiusInt; dx <= radiusInt; dx++) {
            const dxSquared = dx * dx;
            if (dxSquared > radiusSquared)
                continue;
            const maxDzSquared = radiusSquared - dxSquared;
            const maxDz = Math.floor(Math.sqrt(maxDzSquared));
            for (let dz = -maxDz; dz <= maxDz; dz++) {
                const distanceSquared = dxSquared + dz * dz;
                if (distanceSquared <= radiusSquared &&
                    (!hollow || distanceSquared >= innerRadiusSquared)) {
                    let worldPos;
                    if (axis === Axis.Y) {
                        worldPos = world(centerX + dx, centerY + offset, centerZ + dz);
                    }
                    else if (axis === Axis.X) {
                        worldPos = world(centerX + offset, centerY + dx, centerZ + dz);
                    }
                    else { // axis === Axis.Z
                        worldPos = world(centerX + dx, centerY + dz, centerZ + offset);
                    }
                    if (validateCoordinates(worldPos.getValue(Axis.X), worldPos.getValue(Axis.Y), worldPos.getValue(Axis.Z))) {
                        positions.push(worldPos);
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    /**
     * 円柱形座標の計算（最適化アルゴリズム使用）
     * @param center 円柱の底面中心点
     * @param radius 円柱の半径 (1-200ブロック)
     * @param height 円柱の高さ (1-300ブロック)
     * @param hollow 中空円柱を作成するか (デフォルト: false)
     * @param layers 生成する最大レイヤー数 (0 = 全レイヤー, デフォルト: 0)
     * @returns 高性能で円柱を構成する座標配列
     */
    //% weight=20
    //% blockId=minecraftGetCylinderPositions
    //% block="円柱の座標を取得 中心 $center 半径 $radius 高さ $height|| 中空 $hollow 層数制限 $layers"
    //% center.shadow=minecraftCreateWorldInternal
    //% radius.min=1 radius.max=200 radius.defl=5
    //% height.min=1 height.max=300 height.defl=10
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% layers.min=0 layers.max=50 layers.defl=0
    //% expandableArgumentMode="toggle"
    //% group="3D図形（最適化）"
    function getCylinderPositions(center, radius, height, hollow = false, layers = 0) {
        const radiusInt = Math.max(1, Math.round(radius));
        const heightInt = Math.max(1, Math.round(height));
        const layersInt = layers > 0 ? Math.min(layers, heightInt) : heightInt;
        const positions = [];
        // 最適化されたレイヤー分割アルゴリズム
        player.say(getProgressMessage(0));
        for (let i = 0; i < layersInt; i++) {
            const layerCenter = world(center.getValue(Axis.X), center.getValue(Axis.Y) + i, center.getValue(Axis.Z));
            // 各レイヤーで最適化された円を生成
            const circlePositions = getCirclePositionsOptimized(layerCenter, radiusInt, Axis.Y, 0, hollow);
            // MakeCode互換の配列スプレッド代替
            for (const pos of circlePositions) {
                positions.push(pos);
                if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                    player.say(getProgressMessage(positions.length));
                }
            }
        }
        return positions;
    }
    coordinates.getCylinderPositions = getCylinderPositions;
    // ==============================
    // 複雑・高度な3Dシェイプ生成系関数
    // ==============================
    /**
     * 円錐形座標の計算
     * @param center 円錐の底面中心点
     * @param radius 円錐の底面半径
     * @param height 円錐の高さ
     * @param hollow 中空円錐を作成するか (デフォルト: false)
     * @returns 円錐を構成する座標配列
     */
    //% weight=19
    //% blockId=minecraftGetConePositions
    //% block="円錐の座標を取得 中心 $center 半径 $radius 高さ $height|| 中空 $hollow"
    //% center.shadow=minecraftCreateWorldInternal
    //% radius.min=1 radius.max=200 radius.defl=5
    //% height.min=1 height.max=300 height.defl=10
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% expandableArgumentMode="toggle"
    //% group="3D図形（基本）"
    function getConePositions(center, radius, height, hollow = false) {
        const centerX = Math.round(center.getValue(Axis.X));
        const centerY = Math.round(center.getValue(Axis.Y));
        const centerZ = Math.round(center.getValue(Axis.Z));
        const radiusInt = Math.round(radius);
        const heightInt = Math.round(height);
        const positions = [];
        for (let y = 0; y < heightInt; y++) {
            // 高さに応じて半径を線形に減少させる（整数計算でコーン形状を作成）
            const currentRadius = radiusInt * (heightInt - y) / heightInt;
            const currentRadiusSquared = currentRadius * currentRadius;
            const innerRadius = hollow ? Math.max(0, currentRadius - 1) : 0;
            const innerRadiusSquared = innerRadius * innerRadius;
            const radiusIntCeil = Math.ceil(currentRadius);
            for (let x = -radiusIntCeil; x <= radiusIntCeil; x++) {
                const xSquared = x * x;
                if (xSquared > currentRadiusSquared)
                    continue; // 範囲外の早期終了（効率化）
                for (let z = -radiusIntCeil; z <= radiusIntCeil; z++) {
                    const distanceSquared = xSquared + z * z;
                    // 現在の高さでの円の内側かつ、中空の場合は内側の円の外側（コーン形状判定）
                    if (distanceSquared <= currentRadiusSquared &&
                        (!hollow || distanceSquared >= innerRadiusSquared)) {
                        positions.push(world(centerX + x, centerY + y, centerZ + z));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getConePositions = getConePositions;
    /**
     * トーラス（ドーナツ形）座標の計算
     * @param center トーラスの中心点
     * @param majorRadius 主半径（中心からチューブ中心までの距離）
     * @param minorRadius 副半径（チューブの太さ）
     * @param hollow 中空トーラスを作成するか (デフォルト: false)
     * @returns トーラスを構成する座標配列
     */
    //% weight=18
    //% blockId=minecraftGetTorusPositions
    //% block="トーラスの座標を取得 中心 $center 主半径 $majorRadius 副半径 $minorRadius|| 中空 $hollow"
    //% center.shadow=minecraftCreateWorldInternal
    //% majorRadius.min=3 majorRadius.max=200 majorRadius.defl=8
    //% minorRadius.min=1 minorRadius.max=100 minorRadius.defl=3
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% expandableArgumentMode="toggle"
    //% group="3D図形（高度）"
    function getTorusPositions(center, majorRadius, minorRadius, hollow = false) {
        const centerX = Math.round(center.getValue(Axis.X));
        const centerY = Math.round(center.getValue(Axis.Y));
        const centerZ = Math.round(center.getValue(Axis.Z));
        const majorRadiusInt = Math.round(majorRadius);
        const minorRadiusInt = Math.round(minorRadius);
        const totalRadius = majorRadiusInt + minorRadiusInt;
        const minorRadiusSquared = minorRadiusInt * minorRadiusInt;
        const innerMinorRadius = hollow ? Math.max(0, minorRadiusInt - 1) : 0;
        const innerMinorRadiusSquared = innerMinorRadius * innerMinorRadius;
        const positions = [];
        // トーラス生成の最適化: 距離計算を最小限に（ドーナツ形状生成）
        for (let x = -totalRadius; x <= totalRadius; x++) {
            const xSquared = x * x;
            for (let z = -totalRadius; z <= totalRadius; z++) {
                const zSquared = z * z;
                const distanceFromCenterSquared = xSquared + zSquared;
                // 平方根計算を1回のみ（計算効率の最適化）
                const distanceFromCenter = Math.sqrt(distanceFromCenterSquared);
                const distanceFromTubeCenter = Math.abs(distanceFromCenter - majorRadiusInt);
                // 管の範囲外は早期終了（トーラスの管部分のみ処理）
                if (distanceFromTubeCenter > minorRadiusInt)
                    continue;
                // Y範囲を計算で限定（不要な計算を避ける）
                const maxYSquared = minorRadiusSquared - (distanceFromTubeCenter * distanceFromTubeCenter);
                if (maxYSquared < 0)
                    continue;
                const maxY = Math.floor(Math.sqrt(maxYSquared));
                for (let y = -maxY; y <= maxY; y++) {
                    const tubeDistanceSquared = distanceFromTubeCenter * distanceFromTubeCenter + y * y;
                    if (tubeDistanceSquared <= minorRadiusSquared &&
                        (!hollow || tubeDistanceSquared >= innerMinorRadiusSquared)) {
                        positions.push(world(centerX + x, centerY + y, centerZ + z));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getTorusPositions = getTorusPositions;
    /**
     * 楕円体座標の計算（最適化アルゴリズム使用）
     * @param center 楕円体の中心点
     * @param radiusX X軸方向の半径 (1-50ブロック)
     * @param radiusY Y軸方向の半径 (1-50ブロック)
     * @param radiusZ Z軸方向の半径 (1-50ブロック)
     * @param hollow 中空楕円体を作成するか (デフォルト: false)
     * @returns 高性能で楕円体を構成する座標配列
     */
    //% weight=17
    //% blockId=minecraftGetEllipsoidPositions
    //% block="楕円体の座標を取得 中心 $center X半径 $radiusX Y半径 $radiusY Z半径 $radiusZ|| 中空 $hollow"
    //% center.shadow=minecraftCreateWorldInternal
    //% radiusX.min=1 radiusX.max=200 radiusX.defl=5
    //% radiusY.min=1 radiusY.max=200 radiusY.defl=3
    //% radiusZ.min=1 radiusZ.max=200 radiusZ.defl=7
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% expandableArgumentMode="toggle"
    //% group="3D図形（最適化）"
    function getEllipsoidPositions(center, radiusX, radiusY, radiusZ, hollow = false) {
        const centerX = normalizeCoordinate(center.getValue(Axis.X));
        const centerY = normalizeCoordinate(center.getValue(Axis.Y));
        const centerZ = normalizeCoordinate(center.getValue(Axis.Z));
        const radiusXInt = Math.max(1, Math.round(radiusX));
        const radiusYInt = Math.max(1, Math.round(radiusY));
        const radiusZInt = Math.max(1, Math.round(radiusZ));
        const positions = [];
        // 正規化距離計算（シンプルで高効率）
        const maxRadius = Math.max(Math.max(radiusXInt, radiusYInt), radiusZInt);
        player.say(getProgressMessage(0));
        for (let x = centerX - maxRadius; x <= centerX + maxRadius; x++) {
            for (let y = centerY - maxRadius; y <= centerY + maxRadius; y++) {
                for (let z = centerZ - maxRadius; z <= centerZ + maxRadius; z++) {
                    // 正規化距離計算
                    const dx = (x - centerX) / radiusXInt;
                    const dy = (y - centerY) / radiusYInt;
                    const dz = (z - centerZ) / radiusZInt;
                    const normalizedDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    let shouldPlace = false;
                    if (hollow) {
                        // 中空判定：表面のみ
                        shouldPlace = normalizedDistance <= 1 && normalizedDistance >= HOLLOW_THRESHOLD;
                    }
                    else {
                        // 実体判定：内部含む
                        shouldPlace = normalizedDistance <= 1;
                    }
                    if (shouldPlace && validateCoordinates(x, y, z)) {
                        positions.push(world(x, y, z));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getEllipsoidPositions = getEllipsoidPositions;
    /**
     * 2点間の直線座標計算（3D Bresenhamアルゴリズム使用）
     * @param p0 直線の開始点
     * @param p1 直線の終了点
     * @returns 直線を構成する座標配列
     */
    //% weight=100
    //% blockId=minecraftGetLinePositions
    //% block="線の座標を取得 開始 $p0 終了 $p1"
    //% p0.shadow=minecraftCreateWorldInternal
    //% p1.shadow=minecraftCreateWorldInternal
    //% group="2D図形"
    function getLinePositions(p0, p1) {
        const positions = [];
        // 3D Bresenhamアルゴリズム（MakeCodeコア互換）
        let x0 = Math.round(p0.getValue(Axis.X));
        let x1 = Math.round(p1.getValue(Axis.X));
        let y0 = Math.round(p0.getValue(Axis.Y));
        let y1 = Math.round(p1.getValue(Axis.Y));
        let z0 = Math.round(p0.getValue(Axis.Z));
        let z1 = Math.round(p1.getValue(Axis.Z));
        // 少なくとも2つの座標が同じ場合、直線に塗りつぶしを使用する
        if ((x0 == x1 ? 1 : 0) + (y0 == y1 ? 1 : 0) + (z0 == z1 ? 1 : 0) >= 2) {
            // 1Dボリューム - 直線的な塗りつぶし
            const minX = Math.min(x0, x1);
            const maxX = Math.max(x0, x1);
            const minY = Math.min(y0, y1);
            const maxY = Math.max(y0, y1);
            const minZ = Math.min(z0, z1);
            const maxZ = Math.max(z0, z1);
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        positions.push(world(x, y, z));
                    }
                }
            }
            return positions;
        }
        // 3D Bresenhamアルゴリズム
        const dx = Math.abs(x1 - x0);
        const sx = x0 < x1 ? 1 : -1;
        const dy = Math.abs(y1 - y0);
        const sy = y0 < y1 ? 1 : -1;
        const dz = Math.abs(z1 - z0);
        const sz = z0 < z1 ? 1 : -1;
        let dm = dx > dy ? dx : dy;
        dm = dm > dz ? dm : dz;
        let x1_err = Math.floor(dm / 2);
        let y1_err = Math.floor(dm / 2);
        let z1_err = Math.floor(dm / 2);
        for (let i = 0; i <= dm; ++i) {
            positions.push(world(x0, y0, z0));
            x1_err -= dx;
            if (x1_err < 0) {
                x1_err += dm;
                x0 += sx;
            }
            y1_err -= dy;
            if (y1_err < 0) {
                y1_err += dm;
                y0 += sy;
            }
            z1_err -= dz;
            if (z1_err < 0) {
                z1_err += dm;
                z0 += sz;
            }
        }
        return positions;
    }
    coordinates.getLinePositions = getLinePositions;
    /**
     * ヘリックス（螺旋）座標の計算
     * @param center ヘリックスの底面中心点
     * @param radius ヘリックスの半径
     * @param height ヘリックスの合計高さ
     * @param turns 完全回転数（ターン数）
     * @param clockwise 時計回りに回転するか (デフォルト: true)
     * @returns ヘリックスを構成する座標配列
     */
    //% weight=16
    //% blockId=minecraftGetHelixPositions
    //% block="螺旋の座標を取得 中心 $center 半径 $radius 高さ $height 回転数 $turns|| 時計回り $clockwise"
    //% center.shadow=minecraftCreateWorldInternal
    //% radius.min=1 radius.max=200 radius.defl=5
    //% height.min=2 height.max=300 height.defl=20
    //% turns.min=0.5 turns.max=20 turns.defl=3
    //% clockwise.shadow=toggleOnOff clockwise.defl=true
    //% expandableArgumentMode="toggle"
    //% group="3D図形（高度）"
    function getHelixPositions(center, radius, height, turns, clockwise = true) {
        const positionsArr = [];
        const centerX = Math.round(center.getValue(Axis.X));
        const centerY = Math.round(center.getValue(Axis.Y));
        const centerZ = Math.round(center.getValue(Axis.Z));
        const radiusInt = Math.round(radius);
        const heightInt = Math.round(height);
        const direction = clockwise ? 1 : -1;
        // 弧長ベース密度計算（連続性優先）
        const circumference = MATH_CONSTANTS.TWO_PI * radiusInt;
        const totalArcLength = circumference * turns;
        const helixLength = Math.sqrt(totalArcLength * totalArcLength + heightInt * heightInt);
        const steps = Math.max(heightInt * 2, Math.round(helixLength)); // 連続性を保つ密度
        // MakeCode互換の重複除去用（Set代替）
        const seenPositions = [];
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const angle = (turns * MATH_CONSTANTS.TWO_PI) * progress * direction;
            const currentHeight = heightInt * progress;
            // 螺旋の3D座標計算
            const x = centerX + Math.round(radiusInt * Math.cos(angle));
            const y = centerY + Math.round(currentHeight);
            const z = centerZ + Math.round(radiusInt * Math.sin(angle));
            // 重複座標チェック（MakeCode互換）
            const posKey = `${x},${y},${z}`;
            if (seenPositions.indexOf(posKey) === -1) {
                seenPositions.push(posKey);
                if (validateCoordinates(x, y, z)) {
                    positionsArr.push(world(x, y, z));
                    if (positionsArr.length % PROGRESS_INTERVAL_COUNT === 0) {
                        player.say(getProgressMessage(positionsArr.length));
                    }
                }
            }
        }
        return positionsArr;
    }
    coordinates.getHelixPositions = getHelixPositions;
    /**
     * パラボロイド（衛星アンテナ形）座標の計算
     * @param center パラボロイドの底面中心点
     * @param radius 上部の最大半径
     * @param height パラボロイドの高さ
     * @param hollow 中空パラボロイドを作成するか (デフォルト: false)
     * @returns パラボロイドを構成する座標配列
     */
    //% weight=15
    //% blockId=minecraftGetParaboloidPositions
    //% block="パラボロイドの座標を取得 中心 $center 半径 $radius 高さ $height|| 中空 $hollow"
    //% center.shadow=minecraftCreateWorldInternal
    //% radius.min=2 radius.max=200 radius.defl=8
    //% height.min=1 height.max=300 height.defl=10
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% expandableArgumentMode="toggle"
    //% group="3D図形（高度）"
    function getParaboloidPositions(center, radius, height, hollow = false) {
        const positions = [];
        const centerX = Math.round(center.getValue(Axis.X));
        const centerY = Math.round(center.getValue(Axis.Y));
        const centerZ = Math.round(center.getValue(Axis.Z));
        const radiusInt = Math.round(radius);
        const heightInt = Math.round(height);
        const radiusSquared = radiusInt * radiusInt;
        // パラボロイドの方程式: z = (x² + y²) / (4 * focal_length)
        // focal_lengthを調整してheightに合わせる
        const focalLength = radiusSquared / (4 * heightInt);
        for (let y = 0; y < heightInt; y++) {
            // 現在の高さでのパラボラ半径を計算
            const currentRadiusSquared = 4 * focalLength * y;
            const currentRadius = Math.sqrt(currentRadiusSquared);
            const currentRadiusInt = Math.floor(currentRadius);
            if (currentRadiusInt > radiusInt)
                continue; // 最大半径を超えた場合はスキップ
            const innerRadius = hollow ? Math.max(0, currentRadiusInt - 1) : 0;
            const innerRadiusSquared = innerRadius * innerRadius;
            for (let x = -currentRadiusInt; x <= currentRadiusInt; x++) {
                const xSquared = x * x;
                if (xSquared > currentRadiusSquared)
                    continue;
                const maxZSquared = currentRadiusSquared - xSquared;
                const maxZ = Math.floor(Math.sqrt(maxZSquared));
                for (let z = -maxZ; z <= maxZ; z++) {
                    const distanceSquared = xSquared + z * z;
                    if (distanceSquared <= currentRadiusSquared &&
                        (!hollow || distanceSquared >= innerRadiusSquared)) {
                        positions.push(world(centerX + x, centerY + y, centerZ + z));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getParaboloidPositions = getParaboloidPositions;
    /**
     * 双曲面（冷却塔形）座標の計算
     * @param center 双曲面の中心点
     * @param baseRadius 底面の半径
     * @param waistRadius 最も狭い部分（くびれ）の半径
     * @param height 双曲面の合計高さ
     * @param hollow 中空双曲面を作成するか (デフォルト: false)
     * @returns 双曲面を構成する座標配列
     */
    //% weight=14
    //% blockId=minecraftGetHyperboloidPositions
    //% block="双曲面の座標を取得 中心 $center 底面半径 $baseRadius くびれ半径 $waistRadius 高さ $height|| 中空 $hollow"
    //% center.shadow=minecraftCreateWorldInternal
    //% baseRadius.min=3 baseRadius.max=200 baseRadius.defl=10
    //% waistRadius.min=1 waistRadius.max=100 waistRadius.defl=5
    //% height.min=4 height.max=300 height.defl=20
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% expandableArgumentMode="toggle"
    //% group="3D図形（高度）"
    function getHyperboloidPositions(center, baseRadius, waistRadius, height, hollow = false) {
        const positions = [];
        const centerX = Math.round(center.getValue(Axis.X));
        const centerY = Math.round(center.getValue(Axis.Y));
        const centerZ = Math.round(center.getValue(Axis.Z));
        const baseRadiusInt = Math.round(baseRadius);
        const waistRadiusInt = Math.round(waistRadius);
        const heightInt = Math.round(height);
        const halfHeight = Math.floor(heightInt / 2);
        // 双曲面の形状パラメータ
        const a = waistRadiusInt; // 最小半径
        const b = baseRadiusInt - waistRadiusInt; // 半径の変化幅
        for (let y = 0; y < heightInt; y++) {
            // 中心からの距離 (-1 to 1 の範囲)
            const t = (y - halfHeight) / halfHeight;
            // 双曲面の方程式: r(t) = a * sqrt(1 + (t*b/a)²)
            const currentRadius = a * Math.sqrt(1 + (t * b / a) * (t * b / a));
            const currentRadiusInt = Math.round(currentRadius);
            const currentRadiusSquared = currentRadiusInt * currentRadiusInt;
            const innerRadius = hollow ? Math.max(0, currentRadiusInt - 1) : 0;
            const innerRadiusSquared = innerRadius * innerRadius;
            for (let x = -currentRadiusInt; x <= currentRadiusInt; x++) {
                const xSquared = x * x;
                if (xSquared > currentRadiusSquared)
                    continue;
                const maxZSquared = currentRadiusSquared - xSquared;
                const maxZ = Math.floor(Math.sqrt(maxZSquared));
                for (let z = -maxZ; z <= maxZ; z++) {
                    const distanceSquared = xSquared + z * z;
                    if (distanceSquared <= currentRadiusSquared &&
                        (!hollow || distanceSquared >= innerRadiusSquared)) {
                        positions.push(world(centerX + x, centerY + y, centerZ + z));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getHyperboloidPositions = getHyperboloidPositions;
    /**
     * 円の座標計算（公開関数）
     * @param center 円の中心点
     * @param radius 円の半径
     * @param orientation 円の向き（X、Y、またはZ軸）
     * @param hollow 中空の円を作成するか（輪郭のみ）
     * @returns 円を構成する座標配列
     */
    //% weight=95
    //% blockId=minecraftGetCirclePositions
    //% block="円の座標を取得 中心 $center 半径 $radius 向き $orientation|| 中空 $hollow"
    //% center.shadow=minecraftCreateWorldInternal
    //% radius.min=1 radius.max=200 radius.defl=5
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% expandableArgumentMode="toggle"
    //% group="2D図形"
    function getCirclePositions(center, radius, orientation, hollow = false) {
        const positions = [];
        const centerX = Math.round(center.getValue(Axis.X));
        const centerY = Math.round(center.getValue(Axis.Y));
        const centerZ = Math.round(center.getValue(Axis.Z));
        const radiusInt = Math.round(radius);
        // 座標変換関数を軸の向きに応じて設定
        let toWorld;
        if (orientation === Axis.X) {
            // YZ平面の円（X軸に垂直）
            toWorld = (u, v) => world(centerX, centerY + u, centerZ + v);
        }
        else if (orientation === Axis.Y) {
            // XZ平面の円（Y軸に垂直）
            toWorld = (u, v) => world(centerX + u, centerY, centerZ + v);
        }
        else {
            // XY平面の円（Z軸に垂直）
            toWorld = (u, v) => world(centerX + u, centerY + v, centerZ);
        }
        if (hollow) {
            // 中点円アルゴリズム（MakeCodeコア互換）
            let x = radiusInt;
            let y = 0;
            let err = 0;
            while (x >= y) {
                // 8方向の対称点を追加
                positions.push(toWorld(x, y));
                positions.push(toWorld(y, x));
                positions.push(toWorld(-y, x));
                positions.push(toWorld(-x, y));
                positions.push(toWorld(-x, -y));
                positions.push(toWorld(-y, -x));
                positions.push(toWorld(y, -x));
                positions.push(toWorld(x, -y));
                if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                    player.say(getProgressMessage(positions.length));
                }
                if (err <= 0) {
                    y += 1;
                    err += 2 * y + 1;
                }
                if (err > 0) {
                    x -= 1;
                    err -= 2 * x + 1;
                }
            }
        }
        else {
            // 塗りつぶし円（MakeCodeコア互換の効率的実装）
            for (let x = -radiusInt; x <= radiusInt; x++) {
                const xSquared = x * x;
                const maxYSquared = radiusInt * radiusInt - xSquared;
                if (maxYSquared >= 0) {
                    const maxY = Math.floor(Math.sqrt(maxYSquared));
                    for (let y = -maxY; y <= maxY; y++) {
                        positions.push(toWorld(x, y));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getCirclePositions = getCirclePositions;
    /**
     * 球体座標の計算（最適化アルゴリズム使用）
     * @param center 球体の中心点
     * @param radius 球体の半径 (1-200ブロック)
     * @param hollow 中空球体を作成するか（表面のみ）
     * @param density 密度サンプリング係数 (0.1-1.0、デフォルト: 1.0)
     * @returns 高性能で球体を構成する座標配列
     */
    //% weight=90
    //% blockId=minecraftGetSpherePositions
    //% block="球の座標を取得 中心 $center 半径 $radius|| 中空 $hollow 密度 $density"
    //% center.shadow=minecraftCreateWorldInternal
    //% radius.min=1 radius.max=200 radius.defl=5
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% density.min=0.1 density.max=1.0 density.defl=1.0
    //% expandableArgumentMode="toggle"
    //% group="3D図形（最適化）"
    function getSpherePositions(center, radius, hollow = false, density = 1.0) {
        // パラメータ検証
        if (!center) {
            return [];
        }
        if (radius <= 0) {
            return [];
        }
        const positions = [];
        const centerX = normalizeCoordinate(center.getValue(Axis.X));
        const centerY = normalizeCoordinate(center.getValue(Axis.Y));
        const centerZ = normalizeCoordinate(center.getValue(Axis.Z));
        const radiusInt = Math.max(1, Math.round(Math.abs(radius)));
        const radiusSquared = radiusInt * radiusInt;
        const densityFactor = Math.max(0.1, Math.min(1.0, Math.abs(density)));
        // 最適化済み球体アルゴリズム
        player.say(getProgressMessage(0));
        for (let x = centerX - radiusInt; x <= centerX + radiusInt; x++) {
            for (let y = centerY - radiusInt; y <= centerY + radiusInt; y++) {
                for (let z = centerZ - radiusInt; z <= centerZ + radiusInt; z++) {
                    const distance = calculateDistance(x, y, z, centerX, centerY, centerZ);
                    if (shouldPlaceBlock(distance, radiusInt, hollow) && passesDensitySampling(densityFactor)) {
                        positions.push(world(x, y, z));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getSpherePositions = getSpherePositions;
    /**
     * 直方体（矩形プリズム）座標の計算
     * @param corner1 直方体の最初の角の座標
     * @param corner2 反対側の角の座標
     * @param hollow 中空直方体を作成するか（殻のみ）
     * @returns 直方体を構成する座標配列
     */
    //% weight=85
    //% blockId=minecraftGetCuboidPositions
    //% block="直方体の座標を取得 角1 $corner1 角2 $corner2|| 中空 $hollow"
    //% corner1.shadow=minecraftCreateWorldInternal
    //% corner2.shadow=minecraftCreateWorldInternal
    //% hollow.shadow=toggleOnOff hollow.defl=false
    //% expandableArgumentMode="toggle"
    //% group="3D図形（基本）"
    function getCuboidPositions(corner1, corner2, hollow = false) {
        const positions = [];
        // 各軸の最小・最大値を計算（角の位置関係に関係なく正しい範囲を得る）
        const x1 = Math.round(corner1.getValue(Axis.X));
        const y1 = Math.round(corner1.getValue(Axis.Y));
        const z1 = Math.round(corner1.getValue(Axis.Z));
        const x2 = Math.round(corner2.getValue(Axis.X));
        const y2 = Math.round(corner2.getValue(Axis.Y));
        const z2 = Math.round(corner2.getValue(Axis.Z));
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const minZ = Math.min(z1, z2);
        const maxZ = Math.max(z1, z2);
        if (hollow) {
            // 中空直方体（6面の枠組みのみ）
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        // 面上の座標かどうかを判定（少なくとも1つの軸が端にある）
                        const isOnFace = (x === minX || x === maxX) ||
                            (y === minY || y === maxY) ||
                            (z === minZ || z === maxZ);
                        if (isOnFace) {
                            positions.push(world(x, y, z));
                            if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                                player.say(getProgressMessage(positions.length));
                            }
                        }
                    }
                }
            }
        }
        else {
            // 完全直方体（内部も含む）
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        positions.push(world(x, y, z));
                        if (positions.length % PROGRESS_INTERVAL_COUNT === 0) {
                            player.say(getProgressMessage(positions.length));
                        }
                    }
                }
            }
        }
        return positions;
    }
    coordinates.getCuboidPositions = getCuboidPositions;
    // ==============================
    // 最適化されたブロック配置システム
    // ==============================
    /**
     * 座標配列から一意な座標値を取得（MakeCode互換）
     * @param positions 座標配列
     * @param axis 取得する軸 ('x', 'y', 'z')
     * @returns ソートされた一意座標配列
     */
    function getUniqueCoordinates(positions, axis) {
        const coords = [];
        const axisType = axis === 'x' ? Axis.X : axis === 'y' ? Axis.Y : Axis.Z;
        for (const pos of positions) {
            const coord = pos.getValue(axisType);
            if (coords.indexOf(coord) === -1) {
                coords.push(coord);
            }
        }
        return coords.sort((a, b) => a - b);
    }
    /**
     * 座標インデックスマップを作成
     */
    function createIndexMap(coords) {
        const map = {};
        for (let i = 0; i < coords.length; i++) {
            map[coords[i]] = i;
        }
        return map;
    }
    /**
     * 3Dグリッドマップを作成
     */
    function createGridMap(positions, xs, ys, zs) {
        const xMap = createIndexMap(xs);
        const yMap = createIndexMap(ys);
        const zMap = createIndexMap(zs);
        // 3D boolean配列を初期化
        const grid = [];
        for (let x = 0; x < xs.length; x++) {
            grid[x] = [];
            for (let y = 0; y < ys.length; y++) {
                grid[x][y] = [];
                for (let z = 0; z < zs.length; z++) {
                    grid[x][y][z] = false;
                }
            }
        }
        // ブロック存在マップを作成
        for (const pos of positions) {
            const xi = xMap[pos.getValue(Axis.X)];
            const yi = yMap[pos.getValue(Axis.Y)];
            const zi = zMap[pos.getValue(Axis.Z)];
            if (xi !== undefined && yi !== undefined && zi !== undefined) {
                grid[xi][yi][zi] = true;
            }
        }
        return grid;
    }
    /**
     * 高速ブロック配置（改善版貪欲アルゴリズム使用）
     * @param positions 配置する座標配列
     * @param block 配置するブロックタイプ
     */
    //% weight=200
    //% blockId=coordinatesOptimizedFill
    //% block="高速配置 座標配列 $positions ブロック $block=minecraftBlock"
    //% group="高速配置"
    function optimizedFill(positions, block) {
        if (positions.length === 0)
            return;
        player.say(`${coordinates.MESSAGES.PLACEMENT_START} (${positions.length})`);
        // 1. 座標をソートしてグリッド化
        const xs = getUniqueCoordinates(positions, 'x');
        const ys = getUniqueCoordinates(positions, 'y');
        const zs = getUniqueCoordinates(positions, 'z');
        // 2. 3Dグリッドマップを作成（O(1)アクセス）
        const grid = createGridMap(positions, xs, ys, zs);
        let fillCount = 0;
        let blocksPlaced = 0;
        // 3. 改善された貪欲アルゴリズム
        for (let x1 = 0; x1 < xs.length; x1++) {
            for (let y1 = 0; y1 < ys.length; y1++) {
                for (let z1 = 0; z1 < zs.length; z1++) {
                    if (!grid[x1][y1][z1])
                        continue;
                    // 最大直方体を探す（体積優先）
                    let bestVolume = 0;
                    let bestX2 = x1, bestY2 = y1, bestZ2 = z1;
                    // X方向に可能な限り拡張
                    let maxX = x1;
                    while (maxX + 1 < xs.length && grid[maxX + 1][y1][z1]) {
                        maxX++;
                    }
                    // Y方向に可能な限り拡張（X範囲を維持）
                    for (let y2 = y1; y2 < ys.length; y2++) {
                        let yExpandable = true;
                        for (let x = x1; x <= maxX; x++) {
                            if (!grid[x][y2][z1]) {
                                yExpandable = false;
                                break;
                            }
                        }
                        if (!yExpandable)
                            break;
                        // Z方向に可能な限り拡張（XY範囲を維持）
                        for (let z2 = z1; z2 < zs.length; z2++) {
                            let zExpandable = true;
                            for (let x = x1; x <= maxX && zExpandable; x++) {
                                for (let y = y1; y <= y2 && zExpandable; y++) {
                                    if (!grid[x][y][z2]) {
                                        zExpandable = false;
                                    }
                                }
                            }
                            if (!zExpandable)
                                break;
                            // 体積計算
                            const volume = (maxX - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1);
                            if (volume > bestVolume) {
                                bestVolume = volume;
                                bestX2 = maxX;
                                bestY2 = y2;
                                bestZ2 = z2;
                            }
                        }
                    }
                    // 最適直方体を配置
                    if (bestVolume > 0) {
                        const fromPos = world(xs[x1], ys[y1], zs[z1]);
                        const toPos = world(xs[bestX2], ys[bestY2], zs[bestZ2]);
                        blocks.fill(block, fromPos, toPos, FillOperation.Replace);
                        fillCount++;
                        blocksPlaced += bestVolume;
                        // 使用済みブロックをマーク
                        for (let x = x1; x <= bestX2; x++) {
                            for (let y = y1; y <= bestY2; y++) {
                                for (let z = z1; z <= bestZ2; z++) {
                                    grid[x][y][z] = false;
                                }
                            }
                        }
                        // プログレス報告
                        if (fillCount % 100 === 0) {
                            player.say(`${coordinates.MESSAGES.BATCH_PROCESSING}: ${blocksPlaced}/${positions.length}`);
                        }
                    }
                }
            }
        }
        player.say(`${coordinates.MESSAGES.PLACEMENT_COMPLETE}: ${fillCount} fills, ${blocksPlaced} blocks`);
    }
    coordinates.optimizedFill = optimizedFill;
    /**
     * バッチ処理による高速配置（シンプル版）
     * @param positions 配置する座標配列
     * @param block 配置するブロックタイプ
     */
    //% weight=199
    //% blockId=coordinatesSimpleFill
    //% block="シンプル配置 座標配列 $positions ブロック $block=minecraftBlock"
    //% group="高速配置"
    function simpleFill(positions, block) {
        if (positions.length === 0)
            return;
        const BATCH_SIZE = 2048; // MakeCodeの推奨バッチサイズ
        player.say(`${coordinates.MESSAGES.PLACEMENT_START} (${positions.length})`);
        for (let i = 0; i < positions.length; i += BATCH_SIZE) {
            const batchEnd = Math.min(i + BATCH_SIZE, positions.length);
            for (let j = i; j < batchEnd; j++) {
                blocks.place(block, positions[j]);
            }
            // タイムアウト防止とプログレス報告
            if (i + BATCH_SIZE < positions.length) {
                player.say(`${coordinates.MESSAGES.BATCH_PROCESSING}: ${batchEnd}/${positions.length}`);
                loops.pause(20); // 20ms待機でタイムアウト防止
            }
        }
        player.say(`${coordinates.MESSAGES.PLACEMENT_COMPLETE}: ${positions.length} blocks`);
    }
    coordinates.simpleFill = simpleFill;
})(coordinates || (coordinates = {}));

// Appended by build.mjs so the namespace can be required from compare.mjs.
if (typeof loops === 'undefined') { var loops = { pause: function () {} }; }
module.exports = { coordinates: coordinates, Position: Position, world: world, Axis: Axis };
