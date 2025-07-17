import { WebSocket } from 'ws';

// MCPプロトコル型定義
export interface MCPRequest {
    jsonrpc: string;
    id: string | number;
    method: string;
    params?: any;
}

export interface MCPResponse {
    jsonrpc: string;
    id: string | number;
    result?: any;
    error?: MCPError;
}

export interface MCPError {
    code: number;
    message: string;
    data?: any;
}

// MCPツール型定義
export interface Tool {
    name: string;
    description: string;
    inputSchema: InputSchema;
}

export interface InputSchema {
    type: string;
    properties: Record<string, Property>;
    required?: string[];
}

export interface Property {
    type: string;
    description: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    default?: any;
}

// Minecraft WebSocket型定義
export interface MinecraftMessage {
    header: MinecraftHeader;
    body: any;
}

export interface MinecraftHeader {
    version: number;
    requestId?: string;
    messagePurpose: string;
    eventName?: string;
}

export interface MinecraftCommandRequest {
    header: {
        version: number;
        requestId: string;
        messagePurpose: 'commandRequest';
    };
    body: {
        origin: {
            type: string;
        };
        commandLine: string;
        version: number;
    };
}

export interface MinecraftCommandResponse {
    header: {
        version: number;
        requestId: string;
        messagePurpose: 'commandResponse';
    };
    body: {
        statusCode: number;
        statusMessage?: string;
        localplayername?: string;
    };
}

export interface MinecraftEncryptRequest {
    header: {
        version: number;
        requestId: string;
        messagePurpose: 'ws:encrypt';
    };
    body: any;
}

export interface MinecraftEncryptResponse {
    header: {
        version: number;
        requestId: string;
        messagePurpose: 'ws:encrypt';
    };
    body: {
        publicKey: string;
    };
}

// サーバー型定義
export interface ConnectedPlayer {
    ws: WebSocket;
    name: string;
    id: string;
}

export interface ToolCallResult {
    success: boolean;
    message?: string;
    data?: any;
    error?: string;
}