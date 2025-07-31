import { BaseTool, SequenceStep } from '../base/tool';
import { ToolCallResult, InputSchema } from '../../types';

/**
 * Minecraft Wiki検索ツール
 * MediaWiki APIを使用してMinecraft Wikiから情報を検索し、
 * Bedrock Edition特有の情報を提供します
 */
export class MinecraftWikiTool extends BaseTool {
    readonly name = 'minecraft_wiki';
    readonly description = 'Search Minecraft Wiki for Bedrock Edition and Education Edition commands, blocks, items, entities, and game mechanics. Excludes Java Edition-only features. Returns accurate, up-to-date information from the official Minecraft Wiki. Use sequence action for step-by-step information gathering: 1) search for topic, 2) get specific page, 3) get detailed section - reduces overwhelming responses.';
    
    readonly inputSchema: InputSchema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                description: 'Wiki search action to perform',
                enum: ['search', 'get_page', 'get_page_summary', 'get_section', 'sequence']
            },
            query: {
                type: 'string',
                description: 'Search query (e.g., "give command", "diamond sword", "teleport", "setblock")'
            },
            page_title: {
                type: 'string',
                description: 'Specific wiki page title to retrieve'
            },
            title: {
                type: 'string',
                description: 'Wiki page title (alternative parameter name for compatibility)'
            },
            section: {
                type: 'string',
                description: 'Specific section name within a page'
            },
            focus: {
                type: 'string',
                description: 'Focus area for search results',
                enum: ['commands', 'blocks', 'items', 'entities', 'mechanics', 'bedrock_edition', 'education_edition']
            },
            steps: {
                type: 'array',
                description: 'Array of wiki search actions for sequence. Example: [{"type":"search","query":"give command","focus":"commands"},{"type":"get_page","title":"Commands/give"},{"type":"get_section","title":"Commands/give","section":"Syntax"}]. Use this to break down information gathering into manageable steps instead of getting overwhelming responses.',
                items: {
                    type: 'object',
                    description: 'Wiki sequence step',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['search', 'get_page', 'get_page_summary', 'get_section', 'wait'],
                            description: 'Wiki action type'
                        },
                        query: { type: 'string', description: 'Search query for search action' },
                        title: { type: 'string', description: 'Page title for get_page/get_section actions' },
                        page_title: { type: 'string', description: 'Alternative page title parameter' },
                        section: { type: 'string', description: 'Section name for get_section action' },
                        focus: { 
                            type: 'string', 
                            enum: ['commands', 'blocks', 'items', 'entities', 'mechanics', 'bedrock_edition', 'education_edition'],
                            description: 'Search focus area' 
                        },
                        wait_time: { type: 'number', description: 'Wait time in seconds after this step' }
                    },
                    required: ['type']
                }
            }
        },
        required: ['action']
    };

    /**
     * Minecraft Wiki検索を実行します
     * 
     * @param args - Wiki検索パラメータ
     * @param args.action - 実行するアクション（search, get_page, get_page_summary, get_section）
     * @param args.query - 検索クエリ
     * @param args.page_title - 取得するページタイトル
     * @param args.title - 取得するページタイトル（互換性用）
     * @param args.section - 取得するセクション名
     * @param args.focus - 検索フォーカス（commands, blocks, items等）
     * @returns Wiki検索結果
     */
    async execute(args: {
        action: string;
        query?: string;
        page_title?: string;
        title?: string;
        section?: string;
        focus?: string;
        steps?: SequenceStep[];
    }): Promise<ToolCallResult> {
        try {
            const { action } = args;
            let result: any;
            let message: string;

            switch (action) {
                case 'search':
                    if (!args.query) {
                        return { success: false, message: 'Query required for search action' };
                    }
                    result = await this.searchWiki(args.query, args.focus);
                    message = `Wiki search completed for: "${args.query}"`;
                    break;

                case 'get_page':
                    const pageTitle = args.page_title || args.title;
                    if (!pageTitle) {
                        return { success: false, message: 'Page title required for get_page action' };
                    }
                    result = await this.getPageContent(pageTitle);
                    message = `Retrieved wiki page: "${pageTitle}"`;
                    break;

                case 'get_page_summary':
                    const summaryTitle = args.page_title || args.title;
                    if (!summaryTitle) {
                        return { success: false, message: 'Page title required for get_page_summary action' };
                    }
                    result = await this.getPageSummary(summaryTitle);
                    message = `Retrieved wiki page summary: "${summaryTitle}"`;
                    break;

                case 'get_section':
                    const sectionPageTitle = args.page_title || args.title;
                    if (!sectionPageTitle || !args.section) {
                        return { success: false, message: 'Page title and section required for get_section action' };
                    }
                    result = await this.getPageSection(sectionPageTitle, args.section);
                    message = `Retrieved section "${args.section}" from page "${sectionPageTitle}"`;
                    break;

                case 'sequence':
                    if (!args.steps) {
                        return this.createErrorResponse('steps array is required for sequence action');
                    }
                    return await this.executeSequence(args.steps as SequenceStep[]);

                default:
                    return { 
                        success: false, 
                        message: `Unknown action: ${action}. Supported actions: search, get_page, get_page_summary, get_section, sequence` 
                    };
            }

            return {
                success: true,
                message: message,
                data: { action, result, timestamp: Date.now() }
            };

        } catch (error) {
            return {
                success: false,
                message: `Minecraft Wiki search error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * MediaWiki APIを呼び出します
     * 
     * @param params - APIパラメータ
     * @returns API応答
     * @private
     */
    private async callMediaWikiAPI(params: Record<string, string>): Promise<any> {
        const baseParams = {
            format: 'json',
            origin: '*',
            ...params
        };
        
        const url = `https://minecraft.wiki/api.php?${new URLSearchParams(baseParams)}`;
        
        try {
            // タイムアウト付きでfetch APIを使用
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Minecraft-Bedrock-MCP-Server/1.0',
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json() as any;
            
            if (data.error) {
                throw new Error(`MediaWiki API Error: ${data.error.info || data.error.code}`);
            }
            
            return data;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('MediaWiki API request timed out (8 seconds)');
            }
            throw new Error(`MediaWiki API call failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Wiki検索を実行します
     * 
     * @param query - 検索クエリ
     * @param focus - 検索フォーカス
     * @returns 検索結果
     * @private
     */
    private async searchWiki(query: string, focus?: string): Promise<any> {
        // Bedrock Edition/Education Edition特有の情報を優先するようにクエリを調整
        let searchQuery = query;
        if (focus === 'bedrock_edition' || focus === 'commands') {
            searchQuery += ' bedrock edition OR education edition';
        } else if (focus === 'education_edition') {
            searchQuery += ' education edition OR classroom mode';
        }

        const searchParams = {
            action: 'query',
            list: 'search',
            srsearch: searchQuery,
            srlimit: '5', // 10→5に削減で高速化
            srinfo: 'totalhits|suggestion',
            srprop: 'size|wordcount|timestamp|snippet' // 必要な情報のみ取得
        };

        const searchResult = await this.callMediaWikiAPI(searchParams);
        
        if (!searchResult.query || !searchResult.query.search) {
            return { pages: [], totalHits: 0, suggestion: null };
        }

        // 検索結果を処理してBedrock Edition関連を優先
        const pages = searchResult.query.search
            .filter((page: any) => this.isBedrockRelevant(page.title, page.snippet))
            .map((page: any) => ({
                title: page.title,
                snippet: this.cleanSnippet(page.snippet),
                size: page.size,
                wordcount: page.wordcount,
                timestamp: page.timestamp
            }));

        return {
            pages,
            totalHits: searchResult.query.searchinfo?.totalhits || 0,
            suggestion: searchResult.query.searchinfo?.suggestion || null
        };
    }

    /**
     * ページサマリーを取得します
     * 
     * @param pageTitle - ページタイトル
     * @returns ページサマリー
     * @private
     */
    private async getPageSummary(pageTitle: string): Promise<any> {
        const summaryParams = {
            action: 'query',
            prop: 'extracts|info',
            titles: pageTitle,
            exintro: 'true',
            explaintext: 'true',
            exchars: '300', // 500→300に削減
            inprop: 'url'
        };

        const summaryResult = await this.callMediaWikiAPI(summaryParams);
        
        if (!summaryResult.query || !summaryResult.query.pages) {
            return null;
        }

        const pages = Object.values(summaryResult.query.pages) as any[];
        const page = pages[0];

        if (page.missing) {
            return { error: `Page "${pageTitle}" not found` };
        }

        // セクション取得はオプションとして簡素化
        let sections: any[] = [];

        return {
            title: page.title,
            summary: this.extractBedrockInfo(page.extract || ''),
            url: page.fullurl,
            lastModified: page.touched,
            sections: [] // セクションは別途get_sectionで取得
        };
    }

    /**
     * ページコンテンツを取得します
     * 
     * @param pageTitle - ページタイトル
     * @returns ページコンテンツ
     * @private
     */
    private async getPageContent(pageTitle: string): Promise<any> {
        const contentParams = {
            action: 'query',
            prop: 'extracts|info',
            titles: pageTitle,
            exintro: 'true',
            explaintext: 'true',
            exsectionformat: 'wiki',
            inprop: 'url'
        };

        const contentResult = await this.callMediaWikiAPI(contentParams);
        
        if (!contentResult.query || !contentResult.query.pages) {
            return null;
        }

        const pages = Object.values(contentResult.query.pages) as any[];
        const page = pages[0];

        if (page.missing) {
            return null;
        }

        return {
            title: page.title,
            extract: this.extractBedrockInfo(page.extract),
            url: page.fullurl,
            lastModified: page.touched
        };
    }

    /**
     * ページの特定セクションを取得します
     * 
     * @param pageTitle - ページタイトル
     * @param sectionName - セクション名
     * @returns セクションコンテンツ
     * @private
     */
    private async getPageSection(pageTitle: string, sectionName: string): Promise<any> {
        // まずページの全セクションを取得
        const sectionsParams = {
            action: 'parse',
            page: pageTitle,
            prop: 'sections'
        };

        const sectionsResult = await this.callMediaWikiAPI(sectionsParams);
        
        if (!sectionsResult.parse || !sectionsResult.parse.sections) {
            return null;
        }

        // セクション名に一致するセクションを検索
        const section = sectionsResult.parse.sections.find((s: any) => 
            s.line.toLowerCase().includes(sectionName.toLowerCase()) ||
            s.anchor.toLowerCase().includes(sectionName.toLowerCase())
        );

        if (!section) {
            return { error: `Section "${sectionName}" not found in page "${pageTitle}"` };
        }

        // セクションの内容を取得
        const sectionParams = {
            action: 'parse',
            page: pageTitle,
            section: section.index,
            prop: 'text',
            disablelimitreport: 'true'
        };

        const sectionResult = await this.callMediaWikiAPI(sectionParams);
        
        return {
            title: section.line,
            level: section.level,
            content: this.extractBedrockInfo(sectionResult.parse?.text?.['*'] || ''),
            anchor: section.anchor
        };
    }

    /**
     * Bedrock Edition/Education Editionに関連する内容かチェックします
     * 
     * @param title - ページタイトル
     * @param snippet - ページスニペット
     * @returns Bedrock/Education Edition関連かどうか
     * @private
     */
    private isBedrockRelevant(title: string, snippet: string): boolean {
        const supportedKeywords = [
            'bedrock', 'pocket edition', 'mcpe', 'behavior pack',
            'resource pack', 'addon', 'marketplace',
            'education edition', 'minecraft education', 'edu',
            'mcee', 'classroom mode'
        ];
        
        const javaOnlyKeywords = [
            'java edition only', 'java exclusive', 'not available in bedrock',
            'java edition exclusive', 'pc edition only', 'desktop only',
            'mod support', 'forge', 'fabric', 'optifine',
            'not supported in bedrock', 'bedrock does not support'
        ];

        const text = (title + ' ' + snippet).toLowerCase();
        
        // Java専用機能を除外
        if (javaOnlyKeywords.some(keyword => text.includes(keyword))) {
            return false;
        }

        // Bedrock/Education Edition関連キーワードがあるか、または一般的な内容
        return supportedKeywords.some(keyword => text.includes(keyword)) || 
               !text.includes('java edition');
    }

    /**
     * スニペットからHTMLタグを除去します
     * 
     * @param snippet - 元のスニペット
     * @returns クリーンなスニペット
     * @private
     */
    private cleanSnippet(snippet: string): string {
        return snippet
            .replace(/<[^>]+>/g, '') // HTMLタグを除去
            .replace(/&[^;]+;/g, ' ') // HTMLエンティティを除去
            .replace(/\s+/g, ' ') // 連続する空白を単一に
            .trim();
    }

    /**
     * コンテンツからBedrock Edition情報を抽出します
     * 
     * @param content - 元のコンテンツ
     * @returns Bedrock Edition関連情報
     * @private
     */
    private extractBedrockInfo(content: string): string {
        if (!content) return '';

        // HTMLタグを除去
        let cleanContent = content.replace(/<[^>]+>/g, '');
        
        // Bedrock Edition特有の情報を強調
        const bedrockSections = [
            'bedrock edition',
            'pocket edition',
            'behavior pack',
            'commands',
            'syntax'
        ];

        // セクションごとに分割して関連部分を抽出
        const lines = cleanContent.split('\n');
        const relevantLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            if (bedrockSections.some(section => line.includes(section))) {
                // 関連セクションの前後数行を含める
                const start = Math.max(0, i - 2);
                const end = Math.min(lines.length, i + 5);
                relevantLines.push(...lines.slice(start, end));
                i = end - 1; // 次のループでスキップ
            }
        }

        return relevantLines.length > 0 ? relevantLines.join('\n') : cleanContent.slice(0, 1000);
    }

    /**
     * Wiki専用のシーケンスステップ実行
     * 
     * @param step - 実行するステップ
     * @param index - ステップのインデックス
     * @returns ステップ実行結果
     * 
     * @protected
     * @override
     */
    protected async executeSequenceStep(step: SequenceStep, index: number): Promise<ToolCallResult> {
        // wait ステップは基底クラスで処理される
        if (step.type === 'wait') {
            return await super.executeSequenceStep(step, index);
        }

        // Wiki特有のステップを実行
        // titleパラメータをpage_titleにもコピーして互換性を確保
        const wikiArgs = { 
            action: step.type, 
            ...step,
            page_title: step.page_title || step.title // titleからpage_titleにもコピー
        };
        const result = await this.execute(wikiArgs);
        
        // シーケンス内では結果を簡潔にする
        if (result.success && result.data) {
            const data = result.data as any;
            
            // 検索結果の場合、件数のみ表示
            if (step.type === 'search' && data.result?.pages) {
                return {
                    success: true,
                    message: `Step ${index + 1}: Found ${data.result.pages.length} results for "${step.query || 'unknown'}"`,
                    data: { 
                        action: step.type, 
                        count: data.result.pages.length,
                        titles: data.result.pages.slice(0, 3).map((p: any) => p.title)
                    }
                };
            }
            
            // ページ取得の場合、概要のみ
            if (step.type === 'get_page' || step.type === 'get_page_summary') {
                return {
                    success: true,
                    message: `Step ${index + 1}: Retrieved page "${data.result?.title || 'unknown'}"`,
                    data: { 
                        action: step.type, 
                        title: data.result?.title,
                        summary: data.result?.summary?.substring(0, 150) + '...' || data.result?.extract?.substring(0, 150) + '...'
                    }
                };
            }
            
            // セクション取得の場合、セクション内容の要約のみ
            if (step.type === 'get_section') {
                return {
                    success: true,
                    message: `Step ${index + 1}: Retrieved section "${data.result?.title || step.section}" from page`,
                    data: { 
                        action: step.type, 
                        section: data.result?.title || step.section,
                        content: data.result?.content?.substring(0, 200) + '...' || 'Section content retrieved'
                    }
                };
            }
        }
        
        return result;
    }
}