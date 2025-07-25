import { WebSocket } from 'ws';

// MCPプロトコル型定義

/**
 * MCP（Model Context Protocol）リクエストメッセージの型定義
 * JSON-RPC 2.0仕様に準拠したリクエストフォーマット
 * 
 * @interface MCPRequest
 */
export interface MCPRequest {
    jsonrpc: string;
    id: string | number;
    method: string;
    params?: any;
}

/**
 * MCP（Model Context Protocol）レスポンスメッセージの型定義
 * JSON-RPC 2.0仕様に準拠したレスポンスフォーマット
 * 
 * @interface MCPResponse
 */
export interface MCPResponse {
    jsonrpc: string;
    id: string | number;
    result?: any;
    error?: MCPError;
}

/**
 * MCPエラーオブジェクトの型定義
 * JSON-RPC 2.0仕様のエラーフォーマット
 * 
 * @interface MCPError
 */
export interface MCPError {
    code: number;
    message: string;
    data?: any;
}

// MCPツール型定義

/**
 * MCPツールの基本情報を定義するインターフェース
 * AI/LLMがツールを理解するために必要な情報を含む
 * 
 * @interface Tool
 */
export interface Tool {
    name: string;
    description: string;
    inputSchema: InputSchema;
}

/**
 * ツール入力パラメータのJSON Schemaを定義するインターフェース
 * ツールの引数の型、必須項目、制約などを記述
 * 
 * @interface InputSchema
 */
export interface InputSchema {
    type: string;
    properties: Record<string, Property>;
    required?: string[];
}

/**
 * JSON Schemaのプロパティ定義
 * 各パラメータの型、説明、制約を記述
 * 
 * @interface Property
 */
export interface Property {
    type: string;
    description: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    default?: any;
}


// サーバー型定義

/**
 * 接続中のMinecraftプレイヤー情報
 * WebSocket接続とプレイヤー識別情報を保持
 * 
 * @interface ConnectedPlayer
 */
export interface ConnectedPlayer {
    ws: WebSocket | null;
    name: string;
    id: string;
}

/**
 * ツール実行結果の型定義
 * 成功/失敗ステータス、メッセージ、データを含む統一された結果フォーマット
 * 
 * @interface ToolCallResult
 */
export interface ToolCallResult {
    success: boolean;
    message?: string;
    data?: any;
    error?: string;
}