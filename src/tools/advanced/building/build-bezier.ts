import { BaseTool } from '../../base/tool';
import { ToolCallResult, InputSchema } from '../../../types';
import { executeBuildWithOptimization } from '../../../utils/integration/build-executor';
import {
  calculateBezierPositions,
  calculateAdaptiveSegments,
  calculateCubicBezier,
  calculateQuadraticBezier,
} from '../../../utils/geometry/bezier-calculator';
import { BUILD_LIMITS } from '../../../utils/constants/build-limits';
import { BUILD_ERRORS, BUILD_INFO } from '../../../utils/constants/building-messages';

/**
 * ベジェ曲線構造物を建築するツール
 *
 * @description
 * 可変制御点ベジェ曲線を使用して、滑らかで複雑な曲線構造物を建築します。
 * makecode-minecraft-geometry-ext の可変制御点ベジェ曲線を参考に実装。
 * 制御点の数に応じて、2次、3次、またはそれ以上の高次ベジェ曲線を生成できます。
 *
 * @extends BaseTool
 *
 * @example
 * ```typescript
 * const tool = new BuildBezierTool();
 *
 * // 3次ベジェ曲線（制御点2個）
 * await tool.execute({
 *   startX: 0, startY: 70, startZ: 0,
 *   endX: 60, endY: 70, endZ: 30,
 *   controlPoints: [
 *     { x: 20, y: 85, z: 10 },
 *     { x: 40, y: 60, z: 20 }
 *   ],
 *   material: "gold_block"
 * });
 *
 * // 2次ベジェ曲線（制御点1個）- 単純なアーチ
 * await tool.execute({
 *   startX: 0, startY: 70, startZ: 0,
 *   endX: 30, endY: 70, endZ: 0,
 *   controlPoints: [{ x: 15, y: 90, z: 0 }],
 *   material: "stone_bricks"
 * });
 * ```
 *
 * @since 1.1.0
 * @author mcbk-mcp contributors
 */
export class BuildBezierTool extends BaseTool {
  readonly name = 'build_bezier';
  readonly description =
    'Build BEZIER CURVE: smooth curved path, arch, bridge, decorative curve. Specify start point (startX,startY,startZ) + end point (endX,endY,endZ) + control points array. Control points define curve shape. 1 control point = quadratic curve (simple arch), 2+ control points = cubic/higher curves (complex shapes). Perfect for bridges, arches, decorative paths, roller coaster tracks.';

  readonly inputSchema: InputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Build action to perform',
        enum: ['build'],
        default: 'build',
      },
      startX: {
        type: 'number',
        description: 'Start point X coordinate (curve beginning)',
      },
      startY: {
        type: 'number',
        description: 'Start point Y coordinate (height of curve start)',
      },
      startZ: {
        type: 'number',
        description: 'Start point Z coordinate (curve beginning)',
      },
      endX: {
        type: 'number',
        description: 'End point X coordinate (curve end)',
      },
      endY: {
        type: 'number',
        description: 'End point Y coordinate (height of curve end)',
      },
      endZ: {
        type: 'number',
        description: 'End point Z coordinate (curve end)',
      },
      controlPoints: {
        type: 'array',
        description:
          'Control points that define curve shape. Array of {x, y, z} objects. 1 point = quadratic curve, 2 points = cubic curve, 3+ points = higher degree curves. Minimum 1, maximum 10 control points.',
        items: {
          type: 'object',
          description: 'Control point with x, y, z coordinates',
          properties: {
            x: { type: 'number', description: 'Control point X coordinate' },
            y: { type: 'number', description: 'Control point Y coordinate' },
            z: { type: 'number', description: 'Control point Z coordinate' },
          },
          required: ['x', 'y', 'z'],
        },
      },
      material: {
        type: 'string',
        description: 'Block type to build with (e.g. stone, gold_block, quartz_block)',
        default: 'minecraft:stone',
      },
      segments: {
        type: 'number',
        description:
          'Number of segments (more = smoother curve). Auto-calculated if not specified. Range: 10-1000',
        minimum: 10,
        maximum: 1000,
      },
      adaptive: {
        type: 'boolean',
        description:
          'Use adaptive segment calculation based on curve length (recommended for best results)',
        default: true,
      },
    },
    required: ['startX', 'startY', 'startZ', 'endX', 'endY', 'endZ', 'controlPoints'],
  };

  /**
   * ベジェ曲線構造物を建築します
   */
  async execute(args: {
    action?: string;
    startX: number;
    startY: number;
    startZ: number;
    endX: number;
    endY: number;
    endZ: number;
    controlPoints: Array<{ x: number; y: number; z: number }>;
    material?: string;
    segments?: number;
    adaptive?: boolean;
  }): Promise<ToolCallResult> {
    try {
      // Socket-BE API接続確認
      if (!this.world) {
        return { success: false, message: BUILD_ERRORS.WORLD_NOT_AVAILABLE };
      }

      const {
        action = 'build',
        startX,
        startY,
        startZ,
        endX,
        endY,
        endZ,
        controlPoints,
        material = 'minecraft:stone',
        segments,
        adaptive = true,
      } = args;

      // actionパラメータをサポート（現在は build のみ）
      if (action !== 'build') {
        return this.createErrorResponse(BUILD_ERRORS.UNKNOWN_ACTION(action));
      }

      // 制御点の検証
      if (!controlPoints || controlPoints.length === 0) {
        return this.createErrorResponse(BUILD_ERRORS.INVALID_POINTS);
      }

      if (controlPoints.length > 10) {
        return this.createErrorResponse(BUILD_ERRORS.TOO_MANY_CONTROL_POINTS(10));
      }

      // 座標の整数化
      const start = {
        x: Math.floor(startX),
        y: Math.floor(startY),
        z: Math.floor(startZ),
      };

      const end = {
        x: Math.floor(endX),
        y: Math.floor(endY),
        z: Math.floor(endZ),
      };

      const roundedControlPoints = controlPoints.map((p) => ({
        x: Math.floor(p.x),
        y: Math.floor(p.y),
        z: Math.floor(p.z),
      }));

      // ブロックIDの正規化
      let blockId = material;
      if (!blockId.includes(':')) {
        blockId = `minecraft:${blockId}`;
      }

      try {
        // セグメント数の決定
        let finalSegments: number;
        if (segments !== undefined) {
          finalSegments = segments;
        } else if (adaptive) {
          // 適応的セグメント計算
          finalSegments = calculateAdaptiveSegments(start, end, roundedControlPoints);
        } else {
          // デフォルト
          finalSegments = 50;
        }

        // ベジェ曲線の座標を計算
        const positions = calculateBezierPositions(start, end, roundedControlPoints, finalSegments);

        // ブロック数の制限チェック
        if (positions.length > BUILD_LIMITS.LINE) {
          return {
            success: false,
            message: BUILD_ERRORS.TOO_MANY_BLOCKS(BUILD_LIMITS.LINE, positions.length),
          };
        }

        // 最適化されたビルド実行
        const result = await executeBuildWithOptimization(
          this.world,
          positions,
          blockId,
          {
            type: 'bezier',
            start: start,
            end: end,
            controlPoints: roundedControlPoints,
            material: blockId,
            segments: finalSegments,
            apiUsed: 'Socket-BE',
          },
          {}
        );

        return result;
      } catch (buildError) {
        return {
          success: false,
          message: `Building error: ${buildError instanceof Error ? buildError.message : String(buildError)}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Error building Bezier curve: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
