#!/usr/bin/env node

/**
 * 包括的レスポンステストスクリプト
 * 
 * 重要な戻り値を持つ全てのMinecraftコマンドをテストし、
 * 結果を自動解析してレポートを生成します。
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// テスト設定
const SERVER_URL = 'ws://localhost:8001/ws';
const TEST_TIMEOUT = 15000; // 15秒
const REPORT_FILE = 'tests/response-analysis-report.json';

console.log('=== 包括的コマンドレスポンステスト ===\n');

/**
 * テスト対象のコマンド定義
 */
const CRITICAL_COMMANDS = [
    {
        name: 'QueryTarget',
        command: 'querytarget @s',
        expectedFields: ['position', 'yRot', 'dimension'],
        category: 'player_info',
        description: 'プレイヤー位置・状態取得'
    },
    {
        name: 'TestFor',
        command: 'testfor @s',
        expectedFields: ['statusCode'],
        category: 'existence_check',
        description: 'プレイヤー存在確認'
    },
    {
        name: 'GameMode Query',
        command: 'gamemode query @s',
        expectedFields: ['statusCode', 'statusMessage'],
        category: 'player_info',
        description: 'ゲームモード取得'
    },
    {
        name: 'Time Query',
        command: 'time query daytime',
        expectedFields: ['statusCode', 'statusMessage'],
        category: 'world_info',
        description: '時間情報取得'
    },
    {
        name: 'Block Test',
        command: 'testforblock ~ ~ ~ air',
        expectedFields: ['statusCode'],
        category: 'block_check',
        description: 'ブロック存在確認'
    },
    {
        name: 'Player Count',
        command: 'list',
        expectedFields: ['statusCode', 'statusMessage'],
        category: 'server_info',
        description: 'プレイヤー一覧'
    },
    {
        name: 'Scoreboard Query',
        command: 'scoreboard players list @s',
        expectedFields: ['statusCode'],
        category: 'score_info',
        description: 'スコア情報取得'
    }
];

/**
 * テスト結果格納
 */
let testResults = {
    timestamp: new Date().toISOString(),
    summary: {
        total: 0,
        passed: 0,
        failed: 0,
        warnings: 0
    },
    commands: [],
    analysis: {
        responsePatterns: {},
        problematicCommands: [],
        recommendations: []
    }
};

/**
 * Minecraftメッセージ作成
 */
function createMinecraftMessage(purpose, body) {
    return {
        header: {
            version: 1,
            requestId: uuidv4(),
            messagePurpose: purpose
        },
        body: body
    };
}

/**
 * レスポンス構造の詳細解析
 */
function analyzeResponseStructure(response, commandDef) {
    const analysis = {
        hasHeader: !!response.header,
        hasBody: !!response.body,
        statusCode: response.body?.statusCode,
        hasExpectedFields: false,
        fieldAnalysis: {},
        dataStructure: {},
        issues: []
    };

    // 基本構造チェック
    if (!analysis.hasHeader) {
        analysis.issues.push('Missing header');
    }
    if (!analysis.hasBody) {
        analysis.issues.push('Missing body');
    }

    // ステータスコード解析
    if (typeof analysis.statusCode === 'number') {
        analysis.statusCodeValid = true;
        if (analysis.statusCode === 0) {
            analysis.statusCodeMeaning = 'Success';
        } else if (analysis.statusCode > 0) {
            analysis.statusCodeMeaning = 'Error/Warning';
        }
    } else {
        analysis.issues.push('Invalid or missing statusCode');
    }

    // 特別なフィールド解析（QueryTargetなど）
    if (commandDef.name === 'QueryTarget') {
        try {
            const details = response.body?.details || response.body?.statusMessage;
            if (details) {
                const playerData = JSON.parse(details);
                if (Array.isArray(playerData) && playerData.length > 0) {
                    const player = playerData[0];
                    analysis.dataStructure.position = player.position;
                    analysis.dataStructure.rotation = player.yRot;
                    analysis.dataStructure.dimension = player.dimension;
                    analysis.hasExpectedFields = true;
                    
                    // 座標の妥当性チェック
                    if (player.position) {
                        const { x, y, z } = player.position;
                        if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
                            analysis.issues.push('Invalid coordinate data types');
                        }
                        if (y < -64 || y > 320) {
                            analysis.issues.push('Y coordinate out of valid range');
                        }
                    }
                }
            }
        } catch (e) {
            analysis.issues.push(`QueryTarget JSON parse error: ${e.message}`);
        }
    }

    // 期待されるフィールドの存在確認
    for (const field of commandDef.expectedFields) {
        if (field === 'position' || field === 'yRot' || field === 'dimension') {
            // QueryTarget特別処理済み
            continue;
        }
        
        const hasField = response.body && (field in response.body);
        analysis.fieldAnalysis[field] = {
            present: hasField,
            value: hasField ? response.body[field] : null,
            type: hasField ? typeof response.body[field] : null
        };
    }

    return analysis;
}

/**
 * 単一コマンドテスト実行
 */
async function testCommand(ws, commandDef) {
    console.log(`\n📋 テスト: ${commandDef.name} (${commandDef.description})`);
    
    const commandRequest = createMinecraftMessage('commandRequest', {
        origin: { type: 'player' },
        commandLine: commandDef.command,
        version: 1
    });

    try {
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`タイムアウト: ${commandDef.name}`));
            }, 8000);

            const messageHandler = (data) => {
                try {
                    const parsed = JSON.parse(data.toString());
                    if (parsed.header?.messagePurpose === 'commandResponse' &&
                        parsed.header.requestId === commandRequest.header.requestId) {
                        clearTimeout(timeout);
                        ws.removeListener('message', messageHandler);
                        resolve(parsed);
                    }
                } catch (e) {
                    // JSON解析エラーは無視
                }
            };

            ws.on('message', messageHandler);
            ws.send(JSON.stringify(commandRequest));
        });

        // レスポンス解析
        const analysis = analyzeResponseStructure(response, commandDef);
        
        const testResult = {
            command: commandDef.name,
            commandLine: commandDef.command,
            category: commandDef.category,
            success: analysis.issues.length === 0,
            response: response,
            analysis: analysis,
            timestamp: new Date().toISOString()
        };

        // 結果表示
        if (testResult.success) {
            console.log(`  ✅ 成功: ${commandDef.description}`);
            testResults.summary.passed++;
        } else {
            console.log(`  ❌ 問題発見: ${analysis.issues.join(', ')}`);
            testResults.summary.failed++;
            testResults.analysis.problematicCommands.push({
                command: commandDef.name,
                issues: analysis.issues
            });
        }

        // 詳細情報表示
        if (analysis.statusCode !== undefined) {
            console.log(`    ステータス: ${analysis.statusCode} (${analysis.statusCodeMeaning || 'Unknown'})`);
        }
        
        if (commandDef.name === 'QueryTarget' && analysis.dataStructure.position) {
            const pos = analysis.dataStructure.position;
            console.log(`    位置: X=${pos.x}, Y=${pos.y}, Z=${pos.z}`);
        }

        testResults.commands.push(testResult);
        testResults.summary.total++;

        return testResult;

    } catch (error) {
        console.log(`  ❌ エラー: ${error.message}`);
        
        const failedResult = {
            command: commandDef.name,
            commandLine: commandDef.command,
            category: commandDef.category,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };

        testResults.commands.push(failedResult);
        testResults.summary.total++;
        testResults.summary.failed++;
        
        return failedResult;
    }
}

/**
 * 結果分析とレポート生成
 */
function generateAnalysisReport() {
    console.log('\n\n=== 📊 テスト結果分析 ===');
    
    // カテゴリ別集計
    const categoryStats = {};
    testResults.commands.forEach(result => {
        if (!categoryStats[result.category]) {
            categoryStats[result.category] = { total: 0, passed: 0, failed: 0 };
        }
        categoryStats[result.category].total++;
        if (result.success) {
            categoryStats[result.category].passed++;
        } else {
            categoryStats[result.category].failed++;
        }
    });

    console.log('\n📈 カテゴリ別結果:');
    Object.entries(categoryStats).forEach(([category, stats]) => {
        const successRate = ((stats.passed / stats.total) * 100).toFixed(1);
        console.log(`  ${category}: ${stats.passed}/${stats.total} (${successRate}%)`);
    });

    // 推奨事項生成
    const recommendations = [];
    
    if (testResults.summary.failed > 0) {
        recommendations.push('失敗したコマンドの詳細を確認し、WebSocket実装を見直してください');
    }
    
    const queryTargetResult = testResults.commands.find(cmd => cmd.command === 'QueryTarget');
    if (queryTargetResult && !queryTargetResult.success) {
        recommendations.push('QueryTargetコマンドは位置取得に重要です。優先的に修正してください');
    }

    if (categoryStats.player_info && categoryStats.player_info.failed > 0) {
        recommendations.push('プレイヤー情報取得コマンドに問題があります。MCP機能に影響する可能性があります');
    }

    testResults.analysis.recommendations = recommendations;

    // ファイル出力
    const reportPath = path.resolve(REPORT_FILE);
    fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2));
    
    console.log(`\n💾 詳細レポート: ${reportPath}`);
    
    return testResults;
}

/**
 * メインテスト実行
 */
async function runComprehensiveTests() {
    try {
        console.log('🔌 WebSocketサーバー接続中...');
        
        const ws = new WebSocket(SERVER_URL);
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('接続タイムアウト'));
            }, 5000);
            
            ws.on('open', () => {
                clearTimeout(timeout);
                console.log('✅ 接続成功\n');
                resolve();
            });
            
            ws.on('error', reject);
        });

        // 暗号化ハンドシェイク
        const encryptRequest = createMinecraftMessage('ws:encrypt', {});
        ws.send(JSON.stringify(encryptRequest));
        
        // 短時間待機
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('🧪 コマンドテスト開始...');
        
        // 全コマンドテスト実行
        for (const commandDef of CRITICAL_COMMANDS) {
            await testCommand(ws, commandDef);
            // コマンド間の間隔
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        ws.close();

        // 結果分析
        const analysis = generateAnalysisReport();
        
        // 最終結果表示
        console.log('\n=== 🎯 最終結果 ===');
        console.log(`総合成功率: ${((analysis.summary.passed / analysis.summary.total) * 100).toFixed(1)}%`);
        console.log(`成功: ${analysis.summary.passed}, 失敗: ${analysis.summary.failed}`);
        
        if (analysis.analysis.recommendations.length > 0) {
            console.log('\n💡 推奨事項:');
            analysis.analysis.recommendations.forEach((rec, i) => {
                console.log(`  ${i + 1}. ${rec}`);
            });
        }

        process.exit(analysis.summary.failed === 0 ? 0 : 1);

    } catch (error) {
        console.error('❌ テスト実行エラー:', error.message);
        process.exit(1);
    }
}

// メイン実行
runComprehensiveTests();