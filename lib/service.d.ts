import type { NHICard, Snapshot, Version } from "./snapshot.js";
import { SnapshotWatcher } from "./watcher.js";
import type { WatchOptions } from "./watcher.js";
/** 請求的選項。 */
export interface RequestOptions {
    /** 逾時時間（毫秒），範圍為 0 到 2147483647。`null` 代表不限制。 */
    timeout?: number | null;
    /** 用來取消請求的 signal。取消時會丟出 `signal.reason`。 */
    signal?: AbortSignal;
}
/** TW NHI IC Card Service 的客戶端。 */
export declare class TWNHIICCService {
    #private;
    /** TW NHI IC Card Service 的網址前綴。 */
    readonly urlPrefix: URL;
    /** @param urlPrefix TW NHI IC Card Service 的網址前綴，可以包含路徑。預設值：`http://127.0.0.1:12345` */
    constructor(urlPrefix?: string | URL);
    /**
     * 取得 TW NHI IC Card Service 的版本資訊。
     *
     * @param options 預設的逾時時間為 5000 毫秒。
     * @throws {NetworkError} 無法連線到服務。
     * @throws {TimeoutError} 逾時。
     * @throws {ResponseError} 服務回應的內容無法使用。
     */
    getVersion(options?: RequestOptions): Promise<Version>;
    /**
     * 取得所有讀卡機目前的狀態。
     *
     * @param options 預設的逾時時間為 10000 毫秒。服務剛啟動時，最多會等待 5 秒讓第一次掃描完成。
     * @throws {NetworkError} 無法連線到服務。
     * @throws {TimeoutError} 逾時。
     * @throws {ResponseError} 服務回應的內容無法使用，例如服務的版本在 0.3.0 以前。
     */
    getSnapshot(options?: RequestOptions): Promise<Snapshot>;
    /**
     * 取得所有讀卡機中的健保卡。
     *
     * 這個方法看不到服務與讀卡機的錯誤，需要的話請使用 `getSnapshot`。
     *
     * @param options 預設的逾時時間為 10000 毫秒。
     * @throws {NetworkError} 無法連線到服務。
     * @throws {TimeoutError} 逾時。
     * @throws {ResponseError} 服務回應的內容無法使用，例如服務的版本在 0.3.0 以前。
     */
    getCardList(options?: RequestOptions): Promise<NHICard[]>;
    /**
     * 以 WebSocket 監看所有讀卡機的狀態。
     *
     * 會立即開始連線，第一次連線失敗或之後斷線時都會自動重新連線。不用時記得呼叫 `close` 方法。
     *
     * @throws {TypeError} `interval` 或 `retryDelay` 不是數字。
     * @throws {RangeError} `interval` 或 `retryDelay` 超出範圍。
     */
    watch(options?: WatchOptions): SnapshotWatcher;
}
