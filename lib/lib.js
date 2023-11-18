import { NetworkError, TimeoutError } from "./errors.js";
import { sleep } from "./sleep.js";
const RETRY_INTERVAL = 1000;
const fetchWithTimeout = async (url, config = {}) => {
    if (!config.signal && typeof config.timeout !== "undefined" && config.timeout >= 0) {
        config.signal = AbortSignal.timeout(config.timeout);
    }
    let response;
    try {
        response = await fetch(url, config);
    }
    catch (error) {
        if (error instanceof DOMException) {
            throw new TimeoutError("request timeout");
        }
        // We don't use `if (error instanceof Error)` because it might be `false`.
        const tryError = error;
        if (typeof tryError.name === "string" && typeof tryError.message === "string") {
            throw new NetworkError(tryError);
        }
        throw error; // unreachable
    }
    let skipCatch = false;
    try {
        if (response.status === 200) {
            return await response.json();
        }
        else {
            skipCatch = true;
            throw new Error(`status code = ${response.status}, body = ${JSON.stringify(await response.text())}`);
        }
    }
    catch (error) {
        if (skipCatch) {
            throw error;
        }
        if (error instanceof DOMException) {
            throw new TimeoutError("body timeout");
        }
        throw new Error(`status code = ${response.status}, but cannot get the body`);
    }
};
const mapCardList = (cards) => {
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
    urlPrefix;
    apiGetCardList;
    apiGetVersion;
    apiWebsocket;
    webSocket = null;
    webSocketInterval;
    /**
     * 服務嘗試重新連線時要呼叫的函數。當這個函數回傳 `false` 時，則不繼續嘗試重新連線。
     */
    onWebSocketRetry = null;
    /**
     * 伺服器取得健保卡清單時要呼叫的函數。
     */
    onWebSocketUpdate = null;
    /**
     * 如果要使用 WebSocket 相關功能，記得在實體化 `TWNHIICCService` 之後呼叫 `openWebSocket` 方法。
     *
     * @param urlPrefix TW NHI IC Card Service 的網址前綴。預設值： `http://127.0.0.1:12345`
     */
    constructor(urlPrefix = new URL("http://127.0.0.1:12345")) {
        if (typeof urlPrefix === "string") {
            urlPrefix = new URL(urlPrefix);
        }
        this.urlPrefix = urlPrefix;
        this.apiGetCardList = new URL("/", urlPrefix);
        this.apiGetVersion = new URL("/version", urlPrefix);
        this.apiWebsocket = new URL("/ws", urlPrefix);
        if (this.apiWebsocket.protocol === "http:") {
            this.apiWebsocket.protocol = "ws:";
        }
        else if (this.apiWebsocket.protocol === "https:") {
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
    async getVersion(timeout = 5000) {
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
    async getCardList(timeout = 15000) {
        const cards = await fetchWithTimeout(this.apiGetCardList, { timeout: timeout });
        return mapCardList(cards);
    }
    /**
     * 開啟 WebSocket。記得不用時要使用 `closeWebSocket` 方法來釋放資源。
     *
     * @param {interval} 設定伺服器回傳所有讀卡機的健保卡中的基本資料的時間間隔（秒）。預設值： `3`
     *
     * @throws {NetworkError}
     */
    async openWebSocket(interval = 3) {
        if (this.webSocket) {
            return;
        }
        let url = this.apiWebsocket;
        if (typeof interval !== "undefined") {
            if (interval < 0) {
                interval = 0;
            }
            else {
                interval = Math.floor(interval);
            }
            url = new URL(url);
            url.searchParams.append("interval", interval.toString());
        }
        this.webSocketInterval = interval;
        const promise = new Promise((resolve, reject) => {
            const webSocket = new WebSocket(url);
            webSocket.onopen = () => {
                const onclose = () => {
                    if (!this.webSocket) {
                        return;
                    }
                    void retry();
                };
                const onmessage = (event) => {
                    if (this.onWebSocketUpdate) {
                        const cards = JSON.parse(event.data);
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
                        }
                        catch (error) {
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
                let tryError = event.error;
                if (typeof tryError !== "undefined" && typeof tryError.name === "string" && typeof tryError.message === "string") {
                    tryError = new NetworkError(tryError);
                    reject(tryError);
                }
                else {
                    reject(new NetworkError(`Cannot connect to ${url.toString()}`));
                }
            };
        });
        this.webSocket = await promise;
    }
    /**
     * WebSocket 是否正在執行。
     */
    isWebSocketRunning() {
        return this.webSocket !== null;
    }
    /**
     * 關閉 WebSocket。
     */
    closeWebSocket() {
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
    setWebSocketInterval(interval) {
        if (!this.webSocket) {
            return false;
        }
        if (typeof interval !== "undefined") {
            if (interval < 0) {
                interval = 0;
            }
            else {
                interval = Math.floor(interval);
            }
            this.webSocket.send(interval.toString());
            this.webSocketInterval = interval;
            return true;
        }
        else {
            this.webSocketInterval = undefined;
            return false;
        }
    }
}
export { NetworkError, TimeoutError };
