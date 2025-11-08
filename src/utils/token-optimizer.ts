/**
 * Token Optimizer Utility
 * Anthropic記事 "Code Execution with MCP" に基づくトークン削減最適化
 *
 * 主な最適化手法:
 * 1. データフィルタリング - 必要な情報のみを返す
 * 2. サマリー化 - 詳細データの代わりに統計情報を返す
 * 3. 中間結果の圧縮 - 大量データを要約
 *
 * @see https://www.anthropic.com/engineering/code-execution-with-mcp
 */

/**
 * 汎用的なデータ配列要約関数
 * ブロック、エンティティなどの大量データを統計情報に変換
 *
 * @param data - データ配列
 * @param typeExtractor - タイプ情報を抽出する関数
 * @param customAggregator - カスタム集計ロジック（オプション）
 * @returns 統計サマリー
 */
function summarizeData<T, R extends { total: number; byType: Record<string, number> }>(
    data: T[],
    typeExtractor: (item: T) => string,
    customAggregator?: (item: T, result: R) => void,
    defaultResult?: R
): R {
    if (!data || data.length === 0) {
        return defaultResult || { total: 0, byType: {} } as R;
    }

    const result: any = defaultResult || { total: data.length, byType: {} };
    result.total = data.length;

    for (const item of data) {
        // タイプ別カウント
        const type = typeExtractor(item);
        result.byType[type] = (result.byType[type] || 0) + 1;

        // カスタム集計ロジック
        if (customAggregator) {
            customAggregator(item, result);
        }
    }

    return result as R;
}

/**
 * 大量のブロックデータを統計サマリーに変換
 *
 * Before: 10,000行のブロックデータ → 数万トークン
 * After: 統計サマリー → 数百トークン (98%+ 削減)
 *
 * @param blocks - ブロックデータ配列
 * @returns 統計サマリー
 */
export function summarizeBlockData(blocks: any[]): {
    total: number;
    byType: Record<string, number>;
    bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
    };
    volume: number;
} {
    const defaultResult = {
        total: 0,
        byType: {},
        bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
        volume: 0
    };

    if (!blocks || blocks.length === 0) {
        return defaultResult;
    }

    // 境界計算用の初期値
    const boundsTracker = {
        minX: Infinity, maxX: -Infinity,
        minY: Infinity, maxY: -Infinity,
        minZ: Infinity, maxZ: -Infinity
    };

    const result = summarizeData(
        blocks,
        (block) => block.type || block.typeId || 'unknown',
        (block, _res) => {
            // 境界の計算
            if (block.location || block.position) {
                const pos = block.location || block.position;
                boundsTracker.minX = Math.min(boundsTracker.minX, pos.x);
                boundsTracker.maxX = Math.max(boundsTracker.maxX, pos.x);
                boundsTracker.minY = Math.min(boundsTracker.minY, pos.y);
                boundsTracker.maxY = Math.max(boundsTracker.maxY, pos.y);
                boundsTracker.minZ = Math.min(boundsTracker.minZ, pos.z);
                boundsTracker.maxZ = Math.max(boundsTracker.maxZ, pos.z);
            }
        },
        { ...defaultResult, bounds: boundsTracker, volume: 0 }
    );

    // ボリューム計算
    const { minX, maxX, minY, maxY, minZ, maxZ } = boundsTracker;
    result.volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    result.bounds = { minX, maxX, minY, maxY, minZ, maxZ };

    return result;
}

/**
 * エンティティリストを要約
 *
 * @param entities - エンティティ配列
 * @returns エンティティサマリー
 */
export function summarizeEntities(entities: any[]): {
    total: number;
    byType: Record<string, number>;
    players: number;
    mobs: number;
    items: number;
} {
    const defaultResult = {
        total: 0,
        byType: {},
        players: 0,
        mobs: 0,
        items: 0
    };

    if (!entities || entities.length === 0) {
        return defaultResult;
    }

    return summarizeData(
        entities,
        (entity) => entity.typeId || entity.type || 'unknown',
        (entity, result) => {
            const type = entity.typeId || entity.type || 'unknown';
            if (type.includes('player')) result.players++;
            else if (type.includes('item')) result.items++;
            else result.mobs++;
        },
        defaultResult
    );
}

/**
 * 建築結果を最適化
 * 詳細ログの代わりにサマリーを返す
 *
 * @param result - 建築結果
 * @returns 最適化された結果
 */
export function optimizeBuildResult(result: {
    success: boolean;
    message?: string;
    data?: any;
}): {
    success: boolean;
    message: string;
    summary?: {
        blocksPlaced: number;
        buildTime?: number;
        optimizationRatio?: string;
    };
} {
    if (!result.success || !result.data) {
        return {
            success: result.success,
            message: result.message || 'Build operation completed'
        };
    }

    // データからサマリーを抽出
    const summary: any = {};

    if (result.data.blocksPlaced !== undefined) {
        summary.blocksPlaced = result.data.blocksPlaced;
    } else if (result.data.blocks?.length) {
        summary.blocksPlaced = result.data.blocks.length;
    }

    if (result.data.buildTime !== undefined) {
        summary.buildTime = result.data.buildTime;
    }

    if (result.data.optimizationStats) {
        const stats = result.data.optimizationStats;
        if (stats.before && stats.after) {
            const ratio = ((1 - stats.after / stats.before) * 100).toFixed(1);
            summary.optimizationRatio = `${ratio}% reduction (${stats.before} → ${stats.after})`;
        }
    }

    return {
        success: result.success,
        message: result.message || 'Build completed',
        summary: Object.keys(summary).length > 0 ? summary : undefined
    };
}

/**
 * コマンド実行結果を最適化
 * 大量のレスポンスデータをサマリー化
 *
 * @param commandResult - コマンド実行結果
 * @returns 最適化された結果
 */
export function optimizeCommandResult(commandResult: any): {
    success: boolean;
    command?: string;
    summary: string;
    details?: any;
} {
    if (!commandResult) {
        return {
            success: false,
            summary: 'No result data'
        };
    }

    // 成功/失敗の判定
    const success = commandResult.statusCode === 0 ||
                   commandResult.successCount > 0 ||
                   !commandResult.error;

    // サマリー生成
    let summary = success ? 'Command executed successfully' : 'Command failed';

    if (commandResult.successCount !== undefined) {
        summary += ` (${commandResult.successCount} operations)`;
    }

    // 詳細データは最小限に
    const details: any = {};
    if (commandResult.statusMessage) {
        details.status = commandResult.statusMessage;
    }
    if (commandResult.error) {
        details.error = commandResult.error;
    }

    return {
        success,
        command: commandResult.command,
        summary,
        details: Object.keys(details).length > 0 ? details : undefined
    };
}

/**
 * プログレッシブ・ディスクロージャー
 * 最初は要約のみ、詳細は別アクションで取得
 *
 * @param data - 元データ
 * @param detailLevel - 詳細レベル ('summary' | 'basic' | 'full')
 * @returns フィルタリングされたデータ
 */
export function progressiveDisclose<T>(
    data: T[],
    detailLevel: 'summary' | 'basic' | 'full' = 'summary'
): T[] | any {
    if (!data || data.length === 0) return [];

    switch (detailLevel) {
        case 'summary':
            // サマリーのみ（最小トークン）
            return {
                count: data.length,
                hint: `Use detailLevel='basic' to see first 5 items, or 'full' for all ${data.length} items`
            };

        case 'basic':
            // 最初の5件のみ
            return data.slice(0, 5);

        case 'full':
            // 全データ（注意: トークン大量消費）
            return data;

        default:
            return data.slice(0, 5);
    }
}

/**
 * トークン使用量の推定
 *
 * @param text - テキスト
 * @returns 推定トークン数（1トークン ≈ 4文字）
 */
export function estimateTokens(text: string): number {
    // 簡易推定: 英語は4文字/トークン、日本語は2文字/トークン
    const asciiChars = (text.match(/[\x00-\x7F]/g) || []).length;
    const nonAsciiChars = text.length - asciiChars;

    return Math.ceil(asciiChars / 4 + nonAsciiChars / 2);
}

/**
 * レスポンスサイズのチェックと警告
 *
 * @param response - レスポンスオブジェクト
 * @param maxTokens - 最大トークン数（デフォルト: 2000）
 * @returns 警告メッセージ（もしあれば）
 */
export function checkResponseSize(response: any, maxTokens: number = 2000): string | null {
    const responseText = typeof response === 'string'
        ? response
        : JSON.stringify(response);

    const estimatedTokens = estimateTokens(responseText);

    if (estimatedTokens > maxTokens) {
        return `⚠️ Large response (≈${estimatedTokens} tokens). Consider using summary mode to reduce token usage.`;
    }

    return null;
}
