import { NetworkError, ResponseError, TimeoutError } from "./errors.ts";
import { UNEXPECTED_RESPONSE, toSnapshot, toVersion } from "./snapshot.ts";
import type { NHICard, Snapshot, Version } from "./snapshot.ts";
import { MAX_DELAY, validateNumber } from "./validate.ts";
import { SnapshotWatcher } from "./watcher.ts";
import type { WatchOptions } from "./watcher.ts";

/** 請求的選項。 */
export interface RequestOptions {
    /** 逾時時間（毫秒），範圍為 0 到 2147483647。`null` 代表不限制。 */
    timeout?: number | null;
    /** 用來取消請求的 signal。取消時會丟出 `signal.reason`。 */
    signal?: AbortSignal;
}

interface JSONResponse {
    status: number;
    data: unknown;
}

const fetchJSON = async (
    url: URL,
    options: RequestOptions,
    defaultTimeout: number,
): Promise<JSONResponse> => {
    const { timeout = defaultTimeout, signal } = options;

    const validTimeout =
        timeout === null ? undefined : validateNumber("timeout", timeout, 0, MAX_DELAY);
    const timeoutSignal =
        typeof validTimeout === "undefined" ? undefined : AbortSignal.timeout(validTimeout);

    const signals: AbortSignal[] = [];

    if (typeof timeoutSignal !== "undefined") {
        signals.push(timeoutSignal);
    }

    if (typeof signal !== "undefined") {
        signals.push(signal);
    }

    // 依照被中止的是哪個 signal，分辨是使用者取消還是逾時
    const toError = (error: unknown, message: string): unknown => {
        if (signal?.aborted === true) {
            return signal.reason as unknown;
        }

        if (typeof validTimeout !== "undefined" && timeoutSignal?.aborted === true) {
            return new TimeoutError(validTimeout);
        }

        return new NetworkError(message, { cause: error });
    };

    let response: Response;

    try {
        response = await fetch(url, { signal: AbortSignal.any(signals) });
    } catch (error) {
        throw toError(error, `Cannot connect to ${url.href}.`);
    }

    const { status } = response;

    if (status !== 200) {
        // 不讀取 body 時要取消它，才能釋放連線
        response.body?.cancel().catch(() => undefined);

        throw new ResponseError(`The service responded with status ${status}.`, { status });
    }

    let data: unknown;

    try {
        data = await response.json();
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new ResponseError("The response is not valid JSON.", { cause: error, status });
        }

        throw toError(error, `Cannot read the response from ${url.href}.`);
    }

    return { status, data };
};

/** TW NHI IC Card Service 的客戶端。 */
export class TWNHIICCService {
    /** TW NHI IC Card Service 的網址前綴。 */
    readonly urlPrefix: URL;

    readonly #snapshotURL: URL;
    readonly #versionURL: URL;
    readonly #webSocketURL: URL;

    /** @param urlPrefix TW NHI IC Card Service 的網址前綴，可以包含路徑。預設值：`http://127.0.0.1:12345` */
    constructor(urlPrefix: string | URL = "http://127.0.0.1:12345") {
        this.urlPrefix = new URL(urlPrefix);

        // 路徑要以 `/` 結尾，相對路徑才會接在前綴的後面
        const base = new URL(this.urlPrefix);

        if (!base.pathname.endsWith("/")) {
            base.pathname += "/";
        }

        this.#snapshotURL = new URL("./", base);
        this.#versionURL = new URL("version", base);
        this.#webSocketURL = new URL("ws", base);

        if (this.#webSocketURL.protocol === "https:") {
            this.#webSocketURL.protocol = "wss:";
        } else {
            this.#webSocketURL.protocol = "ws:";
        }
    }

    /**
     * 取得 TW NHI IC Card Service 的版本資訊。
     *
     * @param options 預設的逾時時間為 5000 毫秒。
     * @throws {NetworkError} 無法連線到服務。
     * @throws {TimeoutError} 逾時。
     * @throws {ResponseError} 服務回應的內容無法使用。
     */
    async getVersion(options: RequestOptions = {}): Promise<Version> {
        const { status, data } = await fetchJSON(this.#versionURL, options, 5000);

        const version = toVersion(data);

        if (version === null) {
            throw new ResponseError(UNEXPECTED_RESPONSE, { status });
        }

        return version;
    }

    /**
     * 取得所有讀卡機目前的狀態。
     *
     * @param options 預設的逾時時間為 10000 毫秒。服務剛啟動時，最多會等待 5 秒讓第一次掃描完成。
     * @throws {NetworkError} 無法連線到服務。
     * @throws {TimeoutError} 逾時。
     * @throws {ResponseError} 服務回應的內容無法使用，例如服務的版本在 0.3.0 以前。
     */
    async getSnapshot(options: RequestOptions = {}): Promise<Snapshot> {
        const { status, data } = await fetchJSON(this.#snapshotURL, options, 10000);

        const snapshot = toSnapshot(data);

        if (snapshot === null) {
            throw new ResponseError(UNEXPECTED_RESPONSE, { status });
        }

        return snapshot;
    }

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
    async getCardList(options: RequestOptions = {}): Promise<NHICard[]> {
        const snapshot = await this.getSnapshot(options);

        return snapshot.readers.flatMap((reader) =>
            reader.state === "nhi_card" ? [reader.card] : [],
        );
    }

    /**
     * 以 WebSocket 監看所有讀卡機的狀態。
     *
     * 會立即開始連線，第一次連線失敗或之後斷線時都會自動重新連線。不用時記得呼叫 `close` 方法。
     *
     * @throws {TypeError} `interval` 或 `retryDelay` 不是數字。
     * @throws {RangeError} `interval` 或 `retryDelay` 超出範圍。
     */
    watch(options: WatchOptions = {}): SnapshotWatcher {
        return new SnapshotWatcher(this.#webSocketURL, options);
    }
}
