import { NetworkError, TimeoutError } from "./errors.js";
import { sleep } from "./sleep.js";

const RETRY_INTERVAL = 1000;

/**
 * 性別。
 */
export const enum Sex {
    /**
     * 男。
     */
    M = "M",
    /**
     * 女。
     */
    F = "F",
}

interface ServiceNHICard {
    reader_name: string;
    card_no: string;
    full_name: string;
    id_no: string;
    birth_date: string;
    birth_date_timestamp: number;
    sex: Sex;
    issue_date: string;
    issue_date_timestamp: number;
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
    "major": number,
    "minor": number,
    "patch": number,
    "pre": string,
    "text": string,
}

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type WebSocketRetry = (() => boolean | void | Promise<boolean | void>) | null;

export type WebSocketUpdate = ((cards: NHICard[]) => void | Promise<void>) | null;

const fetchWithTimeout = async <T = unknown>(url: URL, config: RequestInit & { timeout?: number } = {}): Promise<T> => {
    if (!config.signal && typeof config.timeout !== "undefined" && config.timeout >= 0) {
        config.signal = AbortSignal.timeout(config.timeout);
    }

    let response: Response;

    try {
        response = await fetch(url, config);
    } catch (error) {
        if (error instanceof DOMException) {
            throw new TimeoutError("request timeout");
        }

        // We don't use `if (error instanceof Error)` because it might be `false`.
        const tryError = error as Error;

        if (typeof tryError.name === "string" && typeof tryError.message === "string") {
            throw new NetworkError(tryError);
        }

        throw error; // unreachable
    }

    let skipCatch = false;

    try {
        if (response.status === 200) {
            return await response.json() as T;
        } else {
            skipCatch = true;
            throw new Error(`status code = ${response.status}, body = ${JSON.stringify(await response.text())}`);
        }
    } catch (error) {
        if (skipCatch) {
            throw error;
        }

        if (error instanceof DOMException) {
            throw new TimeoutError("body timeout");
        }

        throw new Error(`status code = ${response.status}, but cannot get the body`);
    }
};

const mapCardList = (cards: ServiceNHICard[]): NHICard[] => {
    return cards.map((e) => {
        return {
            readerName: e.reader_name,
            cardNo: e.card_no,
            fullName: e.full_name,
            idNo: e.id_no,
            birthday: new Date(e.birth_date_timestamp),
            sex: e.sex,
            issueDate: new Date(e.issue_date_timestamp),
        };
    });
};

export class TWNHIICCService {
    /**
     * TW NHI IC Card Service 的網址前綴。
     */
    readonly urlPrefix: URL;

    private readonly apiGetCardList: URL;
    private readonly apiGetVersion: URL;
    private readonly apiWebsocket: URL;

    private webSocket: InstanceType<typeof WebSocket> | null = null;
    private webSocketInterval: number | undefined;

    /**
     * 服務嘗試重新連線時要呼叫的函數。當這個函數回傳 `false` 時，則不繼續嘗試重新連線。
     */
    onWebSocketRetry: WebSocketRetry = null;

    /**
     * 伺服器取得健保卡清單時要呼叫的函數。
     */
    onWebSocketUpdate: WebSocketUpdate = null;

    /**
     * 如果要使用 WebSocket 相關功能，記得在實體化 `TWNHIICCService` 之後呼叫 `openWebSocket` 方法。
     *
     * @param urlPrefix TW NHI IC Card Service 的網址前綴。預設值： `http://127.0.0.1:12345`
     */
    public constructor(urlPrefix: string | URL = new URL("http://127.0.0.1:12345")) {
        if (typeof urlPrefix === "string") {
            urlPrefix = new URL(urlPrefix);
        }

        this.urlPrefix = urlPrefix;

        this.apiGetCardList = new URL("/", urlPrefix);
        this.apiGetVersion = new URL("/version", urlPrefix);
        this.apiWebsocket = new URL("/ws", urlPrefix);

        if (this.apiWebsocket.protocol === "http:") {
            this.apiWebsocket.protocol = "ws:";
        } else if (this.apiWebsocket.protocol === "https:") {
            this.apiWebsocket.protocol = "wss:";
        }
    }

    /**
     * 取得 TW NHI IC Card Service 的版本資訊。
     *
     * @param timeout 逾時時間（毫秒）。預設值： `5000`
     *
     * @throws {NetworkError}
     * @throws {TimeoutError}
     */
    public async getVersion(timeout = 5000): Promise<Version> {
        return fetchWithTimeout(this.apiGetVersion, { timeout: timeout });
    }

    /**
     * 取得健保卡清單。
     *
     * @param timeout 逾時時間（毫秒）。預設值： `15000`
     *
     * @throws {NetworkError}
     * @throws {TimeoutError}
     */
    public async getCardList(timeout = 15000): Promise<NHICard[]> {
        const cards = await fetchWithTimeout<ServiceNHICard[]>(this.apiGetCardList, { timeout: timeout });

        return mapCardList(cards);
    }

    /**
     * 開啟 WebSocket。記得不用時要使用 `closeWebSocket` 方法來釋放資源。
     *
     * @param {interval} 設定伺服器回傳所有讀卡機的健保卡中的基本資料的時間間隔（秒）。預設值： `3`
     *
     * @throws {NetworkError}
     */
    public async openWebSocket(interval: number | undefined = 3): Promise<void> {
        if (this.webSocket) {
            return;
        }

        let url = this.apiWebsocket;

        if (typeof interval !== "undefined") {
            if (interval < 0) {
                interval = 0;
            } else {
                interval = Math.floor(interval);
            }

            url = new URL(url);

            url.searchParams.append("interval", interval.toString());
        }

        this.webSocketInterval = interval;

        const promise = new Promise<InstanceType<typeof WebSocket>>((resolve, reject) => {
            const webSocket = new WebSocket(url);

            webSocket.onopen = () => {
                const onclose = () => {
                    if (!this.webSocket) {
                        return;
                    }

                    void retry();
                };

                const onmessage: WebSocket["onmessage"] = (event) => {
                    if (this.onWebSocketUpdate) {
                        const cards = JSON.parse(event.data as string) as ServiceNHICard[];

                        const result = this.onWebSocketUpdate(mapCardList(cards));

                        if (result instanceof Promise) {
                            result.catch((error) => {
                                console.error(error);
                            });
                        }
                    }
                };

                const retry = async () => {
                    const t = Date.now();

                    if (this.onWebSocketRetry) {
                        try {
                            const result = await this.onWebSocketRetry();

                            if (result === false) {
                                this.webSocket = null;
                                return;
                            }
                        } catch (error) {
                            console.error(error);
                        }
                    }

                    const d = Date.now() - t;

                    if (d < RETRY_INTERVAL) {
                        await sleep(RETRY_INTERVAL - d);
                    }

                    if (!this.webSocket) {
                        return;
                    }

                    let url = this.apiWebsocket;

                    if (typeof this.webSocketInterval !== "undefined") {
                        url = new URL(url);

                        url.searchParams.append("interval", this.webSocketInterval.toString());
                    }

                    console.debug(`Trying to reconnect ${url.toString()}...`);

                    const newWebSocket = new WebSocket(url);

                    newWebSocket.onopen = () => {
                        newWebSocket.onerror = null;

                        newWebSocket.onclose = onclose;

                        newWebSocket.onmessage = onmessage;

                        this.webSocket = newWebSocket;
                    };

                    newWebSocket.onerror = () => {
                        void retry();
                    };
                };

                webSocket.onerror = null;

                webSocket.onclose = onclose;

                webSocket.onmessage = onmessage;

                resolve(webSocket);
            };

            webSocket.onerror = (event) => {
                let tryError = (event as unknown as { error?: Error }).error;

                if (typeof tryError !== "undefined" && typeof tryError.name === "string" && typeof tryError.message === "string") {
                    tryError = new NetworkError(tryError);

                    reject(tryError);
                } else {
                    reject(new NetworkError(`Cannot connect to ${url.toString()}`));
                }
            };
        });

        this.webSocket = await promise;
    }

    /**
     * WebSocket 是否正在執行。
     */
    public isWebSocketRunning(): boolean {
        return this.webSocket !== null;
    }

    /**
     * 關閉 WebSocket。
     */
    public closeWebSocket() {
        if (this.webSocket) {
            this.webSocket.close(1000);
            this.webSocket = null;
        }
    }

    /**
     * 設定伺服器回傳所有讀卡機的健保卡中的基本資料的時間間隔（秒）。
     *
     * @returns 是否有送出設定
     */
    public setWebSocketInterval(interval: number | undefined): boolean {
        if (!this.webSocket) {
            return false;
        }

        if (typeof interval !== "undefined") {
            if (interval < 0) {
                interval = 0;
            } else {
                interval = Math.floor(interval);
            }
    
            this.webSocket.send(interval.toString());
    
            this.webSocketInterval = interval;
    
            return true;
        } else {
            this.webSocketInterval = undefined;

            return false;
        }
    }
}

export { NetworkError, TimeoutError };
