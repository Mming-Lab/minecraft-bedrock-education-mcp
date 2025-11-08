/**
 * Error Hint System
 * エラーメッセージにコンテキストに応じた解決ヒントを追加
 *
 * AIが自発的に適切なツールを使用するよう促す
 */

/**
 * エラーパターンと対応するヒント定義
 */
interface ErrorPattern {
    /** エラーメッセージのパターン（正規表現または文字列） */
    pattern: RegExp | string;
    /** 表示するヒントメッセージ */
    hint: string;
    /** 推奨ツール名（オプション） */
    suggestedTool?: string;
    /** エラーカテゴリ */
    category: 'block_id' | 'item_id' | 'entity' | 'player' | 'world' | 'syntax' | 'permission' | 'general';
}

/**
 * エラーパターンデータベース
 */
const ERROR_PATTERNS: ErrorPattern[] = [
    // ブロックID関連
    {
        pattern: /unknown block|invalid block|block (type |id )?not found/i,
        hint: '💡 Use the minecraft_wiki tool to search for valid block IDs and their properties.',
        suggestedTool: 'minecraft_wiki',
        category: 'block_id'
    },
    {
        pattern: /cannot find block/i,
        hint: '💡 Tip: Search minecraft_wiki tool with "blocks" to see available block types.',
        suggestedTool: 'minecraft_wiki',
        category: 'block_id'
    },

    // アイテムID関連
    {
        pattern: /unknown item|invalid item|item (type |id )?not found/i,
        hint: '💡 Use the minecraft_wiki tool to search for valid item IDs. Format: minecraft:item_name',
        suggestedTool: 'minecraft_wiki',
        category: 'item_id'
    },
    {
        pattern: /invalid typeId/i,
        hint: '💡 Check item/block format. Use minecraft_wiki tool to find correct IDs (e.g., minecraft:diamond)',
        suggestedTool: 'minecraft_wiki',
        category: 'item_id'
    },

    // エンティティ関連
    {
        pattern: /entity not found|unknown entity|invalid entity/i,
        hint: '💡 Use minecraft_wiki tool to search for entity IDs and spawn information.',
        suggestedTool: 'minecraft_wiki',
        category: 'entity'
    },

    // プレイヤー関連
    {
        pattern: /player not found|no player|player.*not connected/i,
        hint: '💡 Use player tool with action=list_all_players to see currently online players.',
        suggestedTool: 'player',
        category: 'player'
    },
    {
        pattern: /target selector.*failed|no targets matched/i,
        hint: '💡 Check selector syntax. Use @a (all), @p (nearest), @s (self). Verify players are online.',
        category: 'player'
    },

    // ワールド/座標関連
    {
        pattern: /out of (world )?bounds|invalid (coordinates|position)/i,
        hint: '💡 Coordinates must be within world bounds. Use player tool action=get_location to get current position.',
        suggestedTool: 'player',
        category: 'world'
    },
    {
        pattern: /dimension not found|unknown dimension/i,
        hint: '💡 Valid dimensions: overworld, nether, the_end. Use minecraft_wiki to learn about dimensions.',
        suggestedTool: 'minecraft_wiki',
        category: 'world'
    },

    // 構文エラー
    {
        pattern: /syntax error|invalid syntax|parse error/i,
        hint: '💡 Check command syntax. Use minecraft_wiki to search for command usage examples.',
        suggestedTool: 'minecraft_wiki',
        category: 'syntax'
    },
    {
        pattern: /unexpected.*argument|too (many|few) arguments/i,
        hint: '💡 Verify command parameters. Search minecraft_wiki for correct command format.',
        suggestedTool: 'minecraft_wiki',
        category: 'syntax'
    },

    // 権限エラー
    {
        pattern: /permission denied|not allowed|insufficient (permissions|privileges)/i,
        hint: '💡 This operation requires operator permissions. Check player gamemode and abilities.',
        category: 'permission'
    },

    // ゲームモード関連
    {
        pattern: /cannot.*in (survival|adventure|spectator) mode/i,
        hint: '💡 Use player tool with action=set_gamemode to change game mode (creative, survival, adventure, spectator).',
        suggestedTool: 'player',
        category: 'permission'
    }
];

/**
 * エラーメッセージに適切なヒントを追加
 *
 * @param errorMessage - 元のエラーメッセージ
 * @returns ヒント付きエラーメッセージ
 *
 * @example
 * ```typescript
 * const error = "Unknown block: minecraft:daimond_block";
 * const enriched = enrichErrorWithHints(error);
 * // "Unknown block: minecraft:daimond_block
 * //  💡 Use the minecraft_wiki tool to search for valid block IDs..."
 * ```
 */
export function enrichErrorWithHints(errorMessage: string): string {
    if (!errorMessage) return errorMessage;

    // マッチするパターンを検索
    for (const pattern of ERROR_PATTERNS) {
        const matches = typeof pattern.pattern === 'string'
            ? errorMessage.includes(pattern.pattern)
            : pattern.pattern.test(errorMessage);

        if (matches) {
            // ヒントを追加して返す
            return `${errorMessage}\n\n${pattern.hint}`;
        }
    }

    // パターンにマッチしない場合は元のメッセージをそのまま返す
    return errorMessage;
}

/**
 * エラーから推奨ツールを抽出
 *
 * @param errorMessage - エラーメッセージ
 * @returns 推奨ツール名（なければnull）
 */
export function getSuggestedToolForError(errorMessage: string): string | null {
    if (!errorMessage) return null;

    for (const pattern of ERROR_PATTERNS) {
        const matches = typeof pattern.pattern === 'string'
            ? errorMessage.includes(pattern.pattern)
            : pattern.pattern.test(errorMessage);

        if (matches && pattern.suggestedTool) {
            return pattern.suggestedTool;
        }
    }

    return null;
}

/**
 * エラーカテゴリを判定
 *
 * @param errorMessage - エラーメッセージ
 * @returns エラーカテゴリ
 */
export function categorizeError(errorMessage: string): string {
    if (!errorMessage) return 'general';

    for (const pattern of ERROR_PATTERNS) {
        const matches = typeof pattern.pattern === 'string'
            ? errorMessage.includes(pattern.pattern)
            : pattern.pattern.test(errorMessage);

        if (matches) {
            return pattern.category;
        }
    }

    return 'general';
}

/**
 * エラーメッセージの詳細分析
 *
 * @param errorMessage - エラーメッセージ
 * @returns エラー分析結果
 */
export function analyzeError(errorMessage: string): {
    originalMessage: string;
    enrichedMessage: string;
    category: string;
    suggestedTool: string | null;
    hasHint: boolean;
} {
    const enrichedMessage = enrichErrorWithHints(errorMessage);
    const category = categorizeError(errorMessage);
    const suggestedTool = getSuggestedToolForError(errorMessage);
    const hasHint = enrichedMessage !== errorMessage;

    return {
        originalMessage: errorMessage,
        enrichedMessage,
        category,
        suggestedTool,
        hasHint
    };
}
