"use strict";
/**
 * 多言語対応システム（i18n - Internationalization）
 * エラーメッセージ、成功メッセージ、情報メッセージの言語切り替え
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.localeManager = void 0;
exports.t = t;
exports.createTranslator = createTranslator;
exports.initializeLocale = initializeLocale;
exports.getCurrentLocale = getCurrentLocale;
exports.setLocale = setLocale;
/**
 * グローバル言語設定マネージャー
 */
class LocaleManager {
    constructor() {
        this.currentLocale = "en"; // デフォルトは英語
    }
    /**
     * 現在の言語を取得
     */
    getLocale() {
        return this.currentLocale;
    }
    /**
     * 言語を設定
     * @param locale 設定する言語（'en' または 'ja'）
     */
    setLocale(locale) {
        this.currentLocale = locale;
    }
    /**
     * 環境変数から言語を自動検出
     */
    detectLocale() {
        // 1. 環境変数 MINECRAFT_MCP_LANG をチェック
        const envLang = process.env.MINECRAFT_MCP_LANG;
        if (envLang === "ja" || envLang === "en") {
            return envLang;
        }
        // 2. システム言語をチェック
        const systemLang = process.env.LANG || process.env.LANGUAGE || "";
        if (systemLang.startsWith("ja")) {
            return "ja";
        }
        // 3. デフォルトは英語
        return "en";
    }
    /**
     * 自動検出した言語を適用
     */
    autoDetect() {
        this.currentLocale = this.detectLocale();
    }
}
/**
 * グローバルインスタンス（シングルトン）
 */
exports.localeManager = new LocaleManager();
/**
 * 多言語メッセージを取得するヘルパー関数
 *
 * @param messages 言語別メッセージオブジェクト
 * @param key メッセージキー
 * @param args メッセージに渡す引数（パラメータ化メッセージ用）
 * @returns ローカライズされたメッセージ
 *
 * @example
 * ```typescript
 * const messages = {
 *   en: { greeting: 'Hello', error: (code: number) => `Error ${code}` },
 *   ja: { greeting: 'こんにちは', error: (code: number) => `エラー ${code}` }
 * };
 *
 * t(messages, 'greeting'); // 'Hello' または 'こんにちは'
 * t(messages, 'error', 404); // 'Error 404' または 'エラー 404'
 * ```
 */
function t(messages, key, ...args) {
    const locale = exports.localeManager.getLocale();
    const message = messages[locale]?.[key];
    if (!message) {
        // フォールバック: キーが見つからない場合は英語を試す
        const fallbackMessage = messages["en"]?.[key];
        if (!fallbackMessage) {
            return `[Missing translation: ${key}]`;
        }
        return typeof fallbackMessage === "function"
            ? fallbackMessage(...args)
            : fallbackMessage;
    }
    return typeof message === "function" ? message(...args) : message;
}
/**
 * 複数のメッセージを一度に取得するヘルパー
 */
function createTranslator(messages) {
    return (key, ...args) => t(messages, key, ...args);
}
/**
 * 言語設定の初期化（サーバー起動時に呼び出し）
 */
function initializeLocale(locale) {
    if (locale) {
        exports.localeManager.setLocale(locale);
    }
    else {
        exports.localeManager.autoDetect();
    }
}
/**
 * 現在の言語を取得する便利関数
 */
function getCurrentLocale() {
    return exports.localeManager.getLocale();
}
/**
 * 言語を変更する便利関数
 */
function setLocale(locale) {
    exports.localeManager.setLocale(locale);
}
