import { NetworkError, TimeoutError } from "./errors.js";
/**
 * 性別。
 */
export declare const enum Sex {
    /**
     * 男。
     */
    M = "M",
    /**
     * 女。
     */
    F = "F"
}
/**
 * 健保卡。
 */
export interface NHICard {
    /**
     * 讀卡機名稱。
     */
    readerName: string;
    /**
     * 卡號。
     */
    cardNo: string;
    /**
     * 全名。
     */
    fullName: string;
    /**
     * 身份證字號。
     */
    idNo: string;
    /**
     * 生日。
     */
    birthday: Date;
    /**
     * 性別。
     */
    sex: Sex;
    /**
     * 發證日期。
     */
    issueDate: Date;
}
/**
 * TW NHI IC Card Service 的版本資訊。
 */
export interface Version {
    "major": number;
    "minor": number;
    "patch": number;
    "pre": string;
    "text": string;
}
export type WebSocketRetry = (() => boolean | void | Promise<boolean | void>) | null;
export type WebSocketUpdate = ((cards: NHICard[]) => void | Promise<void>) | null;
export declare class TWNHIICCService {
    /**
     * TW NHI IC Card Service 的網址前綴。
     */
    readonly urlPrefix: URL;
    private readonly apiGetCardList;
    private readonly apiGetVersion;
    private readonly apiWebsocket;
    private webSocket;
    private webSocketInterval;
    /**
     * 服務嘗試重新連線時要呼叫的函數。當這個函數回傳 `false` 時，則不繼續嘗試重新連線。
     */
    onWebSocketRetry: WebSocketRetry;
    /**
     * 伺服器取得健保卡清單時要呼叫的函數。
     */
    onWebSocketUpdate: WebSocketUpdate;
    /**
     * 如果要使用 WebSocket 相關功能，記得在實體化 `TWNHIICCService` 之後呼叫 `openWebSocket` 方法。
     *
     * @param urlPrefix TW NHI IC Card Service 的網址前綴。預設值： `http://127.0.0.1:12345`
     */
    constructor(urlPrefix?: string | URL);
    /**
     * 取得 TW NHI IC Card Service 的版本資訊。
     *
     * @param timeout 逾時時間（毫秒）。預設值： `5000`
     *
     * @throws {NetworkError}
     * @throws {TimeoutError}
     */
    getVersion(timeout?: number): Promise<Version>;
    /**
     * 取得健保卡清單。
     *
     * @param timeout 逾時時間（毫秒）。預設值： `15000`
     *
     * @throws {NetworkError}
     * @throws {TimeoutError}
     */
    getCardList(timeout?: number): Promise<NHICard[]>;
    /**
     * 開啟 WebSocket。記得不用時要使用 `closeWebSocket` 方法來釋放資源。
     *
     * @param {interval} 設定伺服器回傳所有讀卡機的健保卡中的基本資料的時間間隔（秒）。預設值： `3`
     *
     * @throws {NetworkError}
     */
    openWebSocket(interval?: number | undefined): Promise<void>;
    /**
     * WebSocket 是否正在執行。
     */
    isWebSocketRunning(): boolean;
    /**
     * 關閉 WebSocket。
     */
    closeWebSocket(): void;
    /**
     * 設定伺服器回傳所有讀卡機的健保卡中的基本資料的時間間隔（秒）。
     *
     * @returns 是否有送出設定
     */
    setWebSocketInterval(interval: number | undefined): boolean;
}
export { NetworkError, TimeoutError };
