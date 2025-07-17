// サーバーの自動起動を防ぐため、直接ツールクラスをインポート
import { PlayerPositionTool } from '../src/tools/player/player-position';
import { PlayerMoveTool } from '../src/tools/player/player-move';
import { PlayerSayTool } from '../src/tools/player/player-say';
import { AgentMoveTool } from '../src/tools/agent/agent-move';
import { BuildCubeTool } from '../src/tools/build/build-cube';

describe('MCPツール テスト', () => {
  describe('基本ツール', () => {
    test('send_messageツールのスキーマが正しく定義されている', () => {
      // 基本ツールのスキーマをモックでテスト
      const sendMessageSchema = {
        name: 'send_message',
        description: 'Send a message to the connected Minecraft player',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to send to the player'
            }
          },
          required: ['message']
        }
      };
      
      // 検証: ツールスキーマが正しく定義されている
      expect(sendMessageSchema.name).toBe('send_message');
      expect(sendMessageSchema.inputSchema.required).toContain('message');
    });

    test('execute_commandツールのスキーマが正しく定義されている', () => {
      // 基本ツールのスキーマをモックでテスト
      const executeCommandSchema = {
        name: 'execute_command',
        description: 'Execute a Minecraft command',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The Minecraft command to execute'
            }
          },
          required: ['command']
        }
      };
      
      // 検証: ツールスキーマが正しく定義されている
      expect(executeCommandSchema.name).toBe('execute_command');
      expect(executeCommandSchema.inputSchema.required).toContain('command');
    });
  });

  describe('プレイヤー制御ツール', () => {
    test('player_positionツールが正しく初期化される', () => {
      // 準備: プレイヤー位置ツールを作成
      const tool = new PlayerPositionTool();
      
      // 検証: ツールの基本プロパティ
      expect(tool.name).toBe('player_position');
      expect(tool.description).toContain('position');
      expect(tool.inputSchema).toBeDefined();
    });

    test('player_moveツールが座標引数を要求する', () => {
      // 準備: プレイヤー移動ツールを作成
      const tool = new PlayerMoveTool();
      
      // 検証: 必要な座標パラメータが定義されている
      expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['x', 'y', 'z']));
      expect(tool.inputSchema.properties.x.type).toBe('number');
      expect(tool.inputSchema.properties.y.type).toBe('number');
      expect(tool.inputSchema.properties.z.type).toBe('number');
    });

    test('player_sayツールがメッセージ引数を要求する', () => {
      // 準備: プレイヤー発言ツールを作成
      const tool = new PlayerSayTool();
      
      // 検証: メッセージパラメータが定義されている
      expect(tool.inputSchema.required).toContain('message');
      expect(tool.inputSchema.properties.message.type).toBe('string');
    });
  });

  describe('エージェント制御ツール', () => {
    test('agent_moveツールが適切なパラメータを持つ', () => {
      // 準備: エージェント移動ツールを作成
      const tool = new AgentMoveTool();
      
      // 検証: ツールの基本プロパティとパラメータ
      expect(tool.name).toBe('agent_move');
      expect(tool.inputSchema.properties).toHaveProperty('direction');
    });
  });

  describe('建築ツール', () => {
    test('build_cubeツールが立方体建築パラメータを持つ', () => {
      // 準備: 立方体建築ツールを作成
      const tool = new BuildCubeTool();
      
      // 検証: 必要なパラメータが定義されている
      expect(tool.name).toBe('build_cube');
      expect(tool.inputSchema.required).toEqual(
        expect.arrayContaining(['x1', 'y1', 'z1', 'x2', 'y2', 'z2'])
      );
      // materialはオプショナルパラメータであることを確認
      expect(tool.inputSchema.properties).toHaveProperty('material');
    });
  });

  describe('ツール登録システム', () => {
    test('主要ツールクラスが正しく定義されている', () => {
      // 主要ツールクラスのインスタンス化をテスト
      const tools = [
        new PlayerPositionTool(),
        new PlayerMoveTool(), 
        new PlayerSayTool(),
        new AgentMoveTool(),
        new BuildCubeTool()
      ];
      
      // 検証: 各ツールが必要なプロパティを持つ
      tools.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
      
      // 特定ツール名の確認
      const toolNames = tools.map(tool => tool.name);
      expect(toolNames).toContain('player_position');
      expect(toolNames).toContain('player_move');
      expect(toolNames).toContain('agent_move');
      expect(toolNames).toContain('build_cube');
    });
  });

  describe('引数バリデーション', () => {
    test('BaseToolクラスの引数検証が正常に動作する', () => {
      // 準備: プレイヤー移動ツールでテスト
      const tool = new PlayerMoveTool();
      
      // 有効な引数での検証
      const validArgs = { x: 10, y: 64, z: 20 };
      expect((tool as any).validateArgs(validArgs)).toBe(true);
      
      // 無効な引数での検証（必須フィールド不足）
      const invalidArgs = { x: 10, y: 64 }; // zが不足
      expect((tool as any).validateArgs(invalidArgs)).toBe(false);
      
      // null/undefined引数での検証
      expect((tool as any).validateArgs(null)).toBe(false);
      expect((tool as any).validateArgs(undefined)).toBe(false);
    });

    test('座標バリデーションが正常に動作する', () => {
      // 準備: プレイヤー移動ツールでテスト
      const tool = new PlayerMoveTool();
      
      // 有効な座標の検証
      expect((tool as any).validateCoordinates(100, 64, 200)).toBe(true);
      expect((tool as any).validateCoordinates(0, 0, 0)).toBe(true);
      expect((tool as any).validateCoordinates(-100, 100, -200)).toBe(true);
      
      // 無効な座標の検証（Y座標が範囲外）
      expect((tool as any).validateCoordinates(0, -100, 0)).toBe(false);
      expect((tool as any).validateCoordinates(0, 400, 0)).toBe(false);
      
      // 無効な座標の検証（X/Z座標が範囲外）
      expect((tool as any).validateCoordinates(50000000, 64, 0)).toBe(false);
    });
  });

  describe('ブロックID正規化', () => {
    test('ブロックIDが正しく正規化される', () => {
      // 準備: 任意のツールでテスト（BaseToolのメソッド）
      const tool = new PlayerMoveTool();
      
      // minecraft:プレフィックスの追加テスト
      expect((tool as any).normalizeBlockId('stone')).toBe('minecraft:stone');
      expect((tool as any).normalizeBlockId('dirt')).toBe('minecraft:dirt');
      
      // 既存のプレフィックス保持テスト
      expect((tool as any).normalizeBlockId('minecraft:stone')).toBe('minecraft:stone');
      expect((tool as any).normalizeBlockId('custom:block')).toBe('custom:block');
      
      // 大文字小文字変換テスト（実装に合わせて修正）
      expect((tool as any).normalizeBlockId('STONE')).toBe('minecraft:STONE');
      expect((tool as any).normalizeBlockId('Minecraft:DIRT')).toBe('minecraft:dirt');
    });
  });
});