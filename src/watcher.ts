import { ResponseError } from "./errors.ts";
import { parseMessage } from "./snapshot.ts";
import type { Snapshot } from "./snapshot.ts";
import { MAX_DELAY, validateNumber } from "./validate.ts";

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

const MIN_INTERVAL = 1;
const MAX_INTERVAL = 86400;

type Timer = ReturnType<typeof setTimeout>;

/**
 * 以 WebSocket 監看所有讀卡機的狀態。請使用 `TWNHIICCService` 的 `watch` 方法建立。
 *
 * 第一次連線失敗或之後斷線時都會自動重新連線，直到呼叫 `close` 方法為止。
 */
export class SnapshotWatcher {
    readonly #url: URL;
    readonly #retryDelay: number;
    readonly #onSnapshot: WatchOptions["onSnapshot"];
    readonly #onConnectionChange: WatchOptions["onConnectionChange"];
    readonly #onError: WatchOptions["onError"];

    #interval: number;
    #socket: WebSocket | null = null;
    #connected = false;
    #snapshot: Snapshot | null = null;
    // 這次連線最後一筆 snapshot 的原始 JSON，用來略過內容相同的心跳訊息
    #lastMessage: string | null = null;
    #aliveTimer: Timer | undefined;
    #retryTimer: Timer | undefined;
    #closed = false;

    /**
     * @param url WebSocket 端點的網址。
     * @throws {TypeError} `interval` 或 `retryDelay` 不是數字。
     * @throws {RangeError} `interval` 或 `retryDelay` 超出範圍。
     */
    constructor(url: URL, options: WatchOptions = {}) {
        const {
            interval = 3,
            retryDelay = 1000,
            onSnapshot,
            onConnectionChange,
            onError,
        } = options;

        this.#interval = validateNumber("interval", interval, MIN_INTERVAL, MAX_INTERVAL, true);
        this.#retryDelay = validateNumber("retryDelay", retryDelay, 0, MAX_DELAY);
        this.#url = new URL(url);
        this.#onSnapshot = onSnapshot;
        this.#onConnectionChange = onConnectionChange;
        this.#onError = onError;

        this.#connect();
    }

    /** 是否已連上服務。 */
    get connected(): boolean {
        return this.#connected;
    }

    /** 最新的讀卡狀態。還沒收到或沒有連上服務時為 `null`。 */
    get snapshot(): Snapshot | null {
        return this.#snapshot;
    }

    /** 讀卡狀態沒有變化時，服務重送目前狀態的時間間隔（秒）。 */
    get interval(): number {
        return this.#interval;
    }

    /**
     * 變更 `interval`。已連上服務時會立即送出，否則會在連上後生效。
     *
     * @throws {TypeError} `seconds` 不是數字。
     * @throws {RangeError} `seconds` 不是 1 到 86400 的整數。
     */
    setInterval(seconds: number): void {
        this.#interval = validateNumber("interval", seconds, MIN_INTERVAL, MAX_INTERVAL, true);

        const socket = this.#socket;

        if (this.#connected && socket !== null) {
            socket.send(String(seconds));

            this.#resetAliveTimer();
        }
    }

    /** 關閉連線並停止重新連線。之後不會再呼叫任何 callback。 */
    close(): void {
        if (this.#closed) {
            return;
        }

        this.#closed = true;

        clearTimeout(this.#retryTimer);

        this.#dropSocket();

        this.#connected = false;
        this.#snapshot = null;
    }

    #connect(): void {
        const interval = this.#interval;

        const url = new URL(this.#url);
        url.searchParams.set("interval", String(interval));

        const socket = new WebSocket(url);

        this.#socket = socket;
        this.#lastMessage = null;

        this.#resetAliveTimer();

        // 被丟棄的 socket 之後仍可能觸發事件，所以每個事件都要先確認它還是目前的 socket
        socket.addEventListener("open", () => {
            if (socket !== this.#socket) {
                return;
            }

            // 連線途中變更過 interval
            if (this.#interval !== interval) {
                socket.send(String(this.#interval));
            }

            this.#connected = true;

            this.#onConnectionChange?.(true);
        });

        socket.addEventListener("message", (event) => {
            if (socket !== this.#socket) {
                return;
            }

            this.#handleMessage(event);
        });

        // 連線失敗時也會觸發 `close`
        socket.addEventListener("close", () => {
            if (socket !== this.#socket) {
                return;
            }

            this.#reconnect();
        });
    }

    #handleMessage(event: MessageEvent): void {
        this.#resetAliveTimer();

        const data: unknown = event.data;

        // 服務只會送出文字訊息
        if (typeof data !== "string" || data === this.#lastMessage) {
            return;
        }

        let snapshot: Snapshot | null;

        try {
            snapshot = parseMessage(data);
        } catch (error) {
            if (error instanceof ResponseError) {
                this.#onError?.(error);

                return;
            }

            throw error;
        }

        if (snapshot === null) {
            return;
        }

        this.#lastMessage = data;
        this.#snapshot = snapshot;

        this.#onSnapshot?.(snapshot);
    }

    // 丟棄目前的 socket，等待 `retryDelay` 後重新連線
    #reconnect(): void {
        const connected = this.#connected;

        this.#dropSocket();

        this.#connected = false;
        this.#snapshot = null;

        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = undefined;

            this.#connect();
        }, this.#retryDelay);

        if (connected) {
            this.#onConnectionChange?.(false);
        }
    }

    #dropSocket(): void {
        clearTimeout(this.#aliveTimer);

        this.#aliveTimer = undefined;

        const socket = this.#socket;

        if (socket !== null) {
            this.#socket = null;

            socket.close();
        }
    }

    // 服務在讀卡狀態沒有變化時，每隔 `interval` 秒會重送一次，所以超過兩倍的時間都沒有收到訊息就當作連線已中斷（也涵蓋卡在連線中的情況）
    #resetAliveTimer(): void {
        clearTimeout(this.#aliveTimer);

        this.#aliveTimer = setTimeout(() => {
            this.#aliveTimer = undefined;

            this.#reconnect();
        }, this.#interval * 2000);
    }
}
