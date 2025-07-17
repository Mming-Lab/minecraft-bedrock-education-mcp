#!/usr/bin/env node

/**
 * WebSocket基本通信テストスクリプト
 * 
 * Minecraftとの接続前にWebSocketサーバーの基本動作を確認します。
 * このテストをパスしてからMinecraftでの実際のテストを行ってください。
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// テスト設定
const SERVER_URL = 'ws://localhost:8001/ws';
const TEST_TIMEOUT = 10000; // 10秒

console.log('=== WebSocket基本通信テスト ===\n');

let testsPassed = 0;
let testsTotal = 0;

/**
 * テスト結果を表示
 */
function logTest(testName, success, message = '') {
    testsTotal++;
    if (success) {
        testsPassed++;
        console.log(`✅ ${testName}`);
    } else {
        console.log(`❌ ${testName}: ${message}`);
    }
}

/**
 * Minecraftスタイルのメッセージを作成
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
 * メインテスト実行
 */
async function runTests() {
    try {
        console.log('1. サーバー接続テスト...');
        
        const ws = new WebSocket(SERVER_URL);
        
        // 接続テスト
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('接続タイムアウト'));
            }, 5000);
            
            ws.on('open', () => {
                clearTimeout(timeout);
                logTest('WebSocket接続', true);
                resolve();
            });
            
            ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });

        console.log('\n2. 暗号化ハンドシェイクテスト...');
        
        // 暗号化リクエストをシミュレート
        const encryptRequest = createMinecraftMessage('ws:encrypt', {});
        
        const encryptResponse = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('暗号化レスポンスタイムアウト'));
            }, 3000);
            
            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.header?.messagePurpose === 'ws:encrypt') {
                        clearTimeout(timeout);
                        resolve(response);
                    }
                } catch (e) {
                    // JSON解析エラーは無視（他のメッセージの可能性）
                }
            });
            
            ws.send(JSON.stringify(encryptRequest));
        });
        
        logTest('暗号化ハンドシェイク', 
            encryptResponse.body?.publicKey === '', 
            '空の公開キーが期待されます');

        console.log('\n3. コマンド送信テスト...');
        
        // 簡単なコマンド送信テスト
        const commandRequest = createMinecraftMessage('commandRequest', {
            origin: { type: 'player' },
            commandLine: 'time query daytime',
            version: 1
        });
        
        ws.send(JSON.stringify(commandRequest));
        logTest('コマンド送信', true, 'コマンド送信が正常に完了');
        
        console.log('\n4. コマンドレスポンス構造テスト...');
        
        // 基本コマンドのレスポンス構造テスト
        const timeResponse = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('timeコマンドレスポンスタイムアウト'));
            }, 5000);
            
            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.header?.messagePurpose === 'commandResponse') {
                        clearTimeout(timeout);
                        resolve(response);
                    }
                } catch (e) {
                    // JSON解析エラーは無視
                }
            });
        });
        
        // レスポンス構造の検証
        const hasRequiredFields = timeResponse.header && 
                                 timeResponse.body && 
                                 typeof timeResponse.body.statusCode === 'number';
        
        logTest('コマンドレスポンス構造', hasRequiredFields);
        console.log(`  ステータスコード: ${timeResponse.body?.statusCode}`);
        console.log(`  ステータスメッセージ: ${timeResponse.body?.statusMessage}`);
        
        console.log('\n5. QueryTarget特化テスト...');
        
        // QueryTargetコマンドの特別テスト
        const queryRequest = createMinecraftMessage('commandRequest', {
            origin: { type: 'player' },
            commandLine: 'querytarget @s',
            version: 1
        });
        
        const queryResponse = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('QueryTargetレスポンスタイムアウト'));
            }, 5000);
            
            ws.send(JSON.stringify(queryRequest));
            
            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.header?.messagePurpose === 'commandResponse' &&
                        response.header.requestId === queryRequest.header.requestId) {
                        clearTimeout(timeout);
                        resolve(response);
                    }
                } catch (e) {
                    // JSON解析エラーは無視
                }
            });
        });
        
        // QueryTargetレスポンスの詳細検証
        let queryTargetValid = false;
        try {
            const details = queryResponse.body?.details || queryResponse.body?.statusMessage;
            if (details) {
                const playerData = JSON.parse(details);
                queryTargetValid = Array.isArray(playerData) && 
                                 playerData.length > 0 && 
                                 playerData[0].position &&
                                 typeof playerData[0].position.x === 'number';
                
                if (queryTargetValid) {
                    const player = playerData[0];
                    console.log(`  プレイヤー位置: X=${player.position.x}, Y=${player.position.y}, Z=${player.position.z}`);
                    console.log(`  回転: ${player.yRot}°`);
                    console.log(`  ディメンション: ${player.dimension}`);
                }
            }
        } catch (parseError) {
            console.log(`  QueryTarget解析エラー: ${parseError.message}`);
        }
        
        logTest('QueryTargetレスポンス解析', queryTargetValid, 
               queryTargetValid ? '' : '位置データの解析に失敗');
        
        console.log('\n6. レスポンス形式総合検証...');
        
        // 複数のコマンドタイプでレスポンス一貫性をテスト
        const commands = [
            'time query daytime',
            'gamemode query @s', 
            'testfor @s'
        ];
        
        let consistentResponses = 0;
        for (const cmd of commands) {
            try {
                const cmdRequest = createMinecraftMessage('commandRequest', {
                    origin: { type: 'player' },
                    commandLine: cmd,
                    version: 1
                });
                
                const cmdResponse = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => resolve(null), 3000);
                    
                    ws.send(JSON.stringify(cmdRequest));
                    
                    ws.on('message', (data) => {
                        try {
                            const response = JSON.parse(data.toString());
                            if (response.header?.messagePurpose === 'commandResponse' &&
                                response.header.requestId === cmdRequest.header.requestId) {
                                clearTimeout(timeout);
                                resolve(response);
                            }
                        } catch (e) {
                            // JSON解析エラーは無視
                        }
                    });
                });
                
                if (cmdResponse && cmdResponse.body && 
                    typeof cmdResponse.body.statusCode === 'number') {
                    consistentResponses++;
                }
            } catch (e) {
                // テストコマンドエラーは無視
            }
        }
        
        logTest('レスポンス形式一貫性', 
               consistentResponses >= 2, 
               `${consistentResponses}/${commands.length}のコマンドが一貫したレスポンス`);
        
        // 1秒待機してからテスト終了
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        ws.close();
        
    } catch (error) {
        logTest('WebSocket接続', false, error.message);
    }
    
    // 結果表示
    console.log('\n=== テスト結果 ===');
    console.log(`成功: ${testsPassed}/${testsTotal}`);
    
    if (testsPassed === testsTotal) {
        console.log('🎉 全テストが成功しました！Minecraftからの接続テストに進んでください。');
        console.log('\nMinecraft接続コマンド:');
        console.log('/connect localhost:8001/ws');
    } else {
        console.log('⚠️  一部のテストが失敗しました。サーバーの状態を確認してください。');
        console.log('\n確認事項:');
        console.log('- サーバーが起動しているか: npm start');
        console.log('- ポート8001が利用可能か');
        console.log('- ファイアウォールの設定');
    }
    
    process.exit(testsPassed === testsTotal ? 0 : 1);
}

// メイン実行
runTests().catch((error) => {
    console.error('テスト実行エラー:', error);
    process.exit(1);
});