import { ResponseError } from "./errors.js";
import type { Snapshot } from "./snapshot.js";
/** 監看讀卡機的選項。 */
export interface WatchOptions {
    /**
     * 讀卡狀態沒有變化時，服務重送目前狀態的時間間隔（秒），範圍為 1 到 86400 的整數。預設值：`3`
     *
     * 超過兩倍的 `interval` 都沒有收到訊息時，會當作連線已中斷並重新連線。
     */
    interval?: number;
    /** 斷線後要等多久才重新連線（毫秒），範圍為 0 到 2147483647。預設值：`1000` */
    retryDelay?: number;
    /** 每次連上服務後的第一筆讀卡狀態，以及之後讀卡狀態改變時，會呼叫這個函數。 */
    onSnapshot?: (snapshot: Snapshot) => void;
    /** 連上服務或與服務斷線時，會呼叫這個函數。 */
    onConnectionChange?: (connected: boolean) => void;
    /** 收到無法解析的訊息時（例如服務的版本在 0.3.0 以前），會呼叫這個函數。 */
    onError?: (error: ResponseError) => void;
}
/**
 * 以 WebSocket 監看所有讀卡機的狀態。請使用 `TWNHIICCService` 的 `watch` 方法建立。
 *
 * 第一次連線失敗或之後斷線時都會自動重新連線，直到呼叫 `close` 方法為止。
 */
export declare class SnapshotWatcher {
    #private;
    /**
     * @param url WebSocket 端點的網址。
     * @throws {TypeError} `interval` 或 `retryDelay` 不是數字。
     * @throws {RangeError} `interval` 或 `retryDelay` 超出範圍。
     */
    constructor(url: URL, options?: WatchOptions);
    /** 是否已連上服務。 */
    get connected(): boolean;
    /** 最新的讀卡狀態。還沒收到或沒有連上服務時為 `null`。 */
    get snapshot(): Snapshot | null;
    /** 讀卡狀態沒有變化時，服務重送目前狀態的時間間隔（秒）。 */
    get interval(): number;
    /**
     * 變更 `interval`。已連上服務時會立即送出，否則會在連上後生效。
     *
     * @throws {TypeError} `seconds` 不是數字。
     * @throws {RangeError} `seconds` 不是 1 到 86400 的整數。
     */
    setInterval(seconds: number): void;
    /** 關閉連線並停止重新連線。之後不會再呼叫任何 callback。 */
    close(): void;
}
