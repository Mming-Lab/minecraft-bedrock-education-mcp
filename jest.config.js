module.exports = {
  // TypeScriptファイルを処理するためのプリセット
  preset: 'ts-jest',
  
  // テスト環境をNode.jsに設定
  testEnvironment: 'node',
  
  // テストファイルのパターン
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  
  // カバレッジ収集対象
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ],
  
  // カバレッジ出力ディレクトリ
  coverageDirectory: 'coverage',
  
  // カバレッジレポートの形式
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  
  // モジュール解決のベースディレクトリ
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  
  // TypeScriptの設定
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: false
    }]
  },
  
  // ファイル拡張子の解決順序
  moduleFileExtensions: ['ts', 'js', 'json'],
  
  // セットアップファイル（必要に応じて）
  // setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  
  // テスト実行時の詳細出力
  verbose: true
};