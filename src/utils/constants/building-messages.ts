/**
 * 建築ツール用エラーメッセージと情報メッセージの一元管理
 *
 * makecode-minecraft-geometry-ext を参考に、すべてのメッセージを
 * 定数化して保守性と一貫性を向上させています
 */

/**
 * エラーメッセージ定義
 */
export const BUILD_ERRORS = {
  // 座標関連
  INVALID_CENTER: 'Invalid center position: coordinates must be valid Minecraft world positions',
  EXTENDS_BEYOND_Y_BOUNDS: 'Shape extends beyond valid Y coordinates (-64 to 320)',
  EXTENDS_BEYOND_WORLD_BOUNDS: 'Shape extends beyond valid world coordinates (-30000000 to 30000000)',
  COORDINATE_OUT_OF_RANGE: 'One or more coordinates are out of valid range',

  // パラメータ検証
  INVALID_RADIUS: 'Invalid radius: must be a positive number within allowed limits',
  RADIUS_TOO_LARGE: (max: number) => `Radius must not exceed ${max} blocks`,
  RADIUS_OUT_OF_RANGE: (min: number, max: number) => `Radius must be between ${min} and ${max}`,

  // サイズ制限
  TOO_MANY_BLOCKS: (max: number, actual: number) =>
    `Too many blocks to place (${actual.toLocaleString()} > ${max.toLocaleString()} limit)`,
  BLOCKS_EXCEED_SAFETY_LIMIT: 'Shape would require too many blocks for performance reasons',

  // 形状パラメータ
  INVALID_HEIGHT: 'Invalid height: must be a positive number',
  HEIGHT_OUT_OF_RANGE: (min: number, max: number) => `Height must be between ${min} and ${max}`,

  INVALID_WIDTH: 'Invalid width: must be a positive number',
  INVALID_LENGTH: 'Invalid length: must be a positive number',

  INVALID_MAJOR_RADIUS: 'Invalid major radius (outer radius): must be positive',
  INVALID_MINOR_RADIUS: 'Invalid minor radius (inner radius): must be positive and less than major radius',
  MAJOR_RADIUS_TOO_SMALL: 'Major radius must be larger than minor radius',

  INVALID_POINTS: 'Invalid control points: must provide at least 2 points for Bezier curve',
  TOO_MANY_CONTROL_POINTS: (max: number) => `Too many control points (maximum: ${max})`,

  // マテリアル関連
  INVALID_MATERIAL: 'Invalid block type: unknown material',
  MATERIAL_NOT_SPECIFIED: 'Material/block type not specified',

  // 方向関連
  INVALID_DIRECTION: 'Invalid direction: must be +x, +y, +z, -x, -y, -z, or custom',

  // ワールド状態
  WORLD_NOT_AVAILABLE: 'World not available. Ensure Minecraft is connected via WebSocket',
  BUILD_IN_PROGRESS: 'Another build operation is in progress',

  // 内部エラー
  UNKNOWN_ACTION: (action: string) => `Unknown action: ${action}. Only 'build' is supported`,
  BUILDING_ERROR: 'An unexpected error occurred during building',
  ROTATION_FAILED: 'Failed to apply rotation transformation',
  COORDINATES_CALCULATION_FAILED: 'Failed to calculate shape coordinates',
} as const;

/**
 * 成功メッセージ定義
 */
export const BUILD_SUCCESS = {
  SHAPE_PLACED: (shape: string, blocks: number) =>
    `${shape} placed successfully: ${blocks.toLocaleString()} blocks`,
  BUILD_COMPLETE: 'Build operation completed',
  OPERATION_QUEUED: 'Build operation queued and starting',
} as const;

/**
 * 情報メッセージ定義
 */
export const BUILD_INFO = {
  GENERATING: 'Generating shape coordinates...',
  CALCULATING: 'Calculating geometry...',
  VALIDATING: 'Validating parameters...',
  OPTIMIZING: 'Optimizing block placement...',
  BUILDING: 'Building shape...',
  BATCH_PROCESSING: 'Processing in batches...',
} as const;

/**
 * 警告メッセージ定義
 */
export const BUILD_WARNINGS = {
  LARGE_SHAPE: (blocks: number) =>
    `Warning: Large shape with ${blocks.toLocaleString()} blocks may take time to build`,
  PERFORMANCE_CONSIDERATION: 'Consider using smaller dimensions for better performance',
  PARTIAL_BUILD: 'Build operation completed with some blocks skipped',
} as const;

/**
 * 座標検証メッセージ
 */
export const COORDINATE_VALIDATION = {
  X_OUT_OF_RANGE: (x: number) => `X coordinate ${x} is out of valid range`,
  Y_OUT_OF_RANGE: (y: number) => `Y coordinate ${y} is out of valid range (-64 to 320)`,
  Z_OUT_OF_RANGE: (z: number) => `Z coordinate ${z} is out of valid range`,
  NORMALIZED_TO: (original: number, normalized: number) =>
    `Coordinate normalized from ${original} to ${normalized}`,
} as const;

/**
 * メッセージを使用した詳細なエラーレスポンスを生成するヘルパー関数
 */
export function createErrorMessage(
  type: 'coordinate' | 'parameter' | 'limit' | 'world' | 'internal',
  message: string
): string {
  const prefix = {
    coordinate: '[Coordinate Error]',
    parameter: '[Parameter Error]',
    limit: '[Limit Error]',
    world: '[World Error]',
    internal: '[Internal Error]'
  };

  return `${prefix[type]} ${message}`;
}

/**
 * メッセージが関数型（パラメータを受け取る）かどうかを判定
 * 実際の使用例：
 * ```typescript
 * const msg = BUILD_ERRORS.RADIUS_OUT_OF_RANGE(1, 20);
 * ```
 */
