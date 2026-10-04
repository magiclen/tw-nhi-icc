

/** 無法連線到 TW NHI IC Card Service 時的錯誤。原始的錯誤放在 `cause`。 */ class NetworkError extends Error {
    name = "NetworkError";
}
/** 請求逾時的錯誤。 */ class TimeoutError extends NetworkError {
    name = "TimeoutError";
    /** 逾時時間（毫秒）。 */ timeout;
    constructor(timeout){
        super(`The request did not finish within ${timeout} ms.`);
        this.timeout = timeout;
    }
}
/** 服務回應的內容無法使用時的錯誤，例如 HTTP 狀態碼不是 200，或是 JSON 的格式不符。 */ class ResponseError extends Error {
    name = "ResponseError";
    /** HTTP 狀態碼。WebSocket 訊息的錯誤沒有狀態碼，為 `undefined`。 */ status;
    constructor(message, options = {}){
        super(message, options);
        this.status = options.status;
    }
}


/** 性別。 */ const Sex = {
    /** 男。 */ M: "M",
    /** 女。 */ F: "F"
};
const UNEXPECTED_RESPONSE = "The response is not in the expected format. TW NHI IC Card Service 0.3.0 or later is required.";
const isObject = (value)=>typeof value === "object" && value !== null;
// 只檢查最外層，其餘的欄位相信服務
const isRawSnapshot = (value)=>isObject(value) && value.type === "snapshot" && Array.isArray(value.readers);
const toReader = (reader)=>{
    switch(reader.state){
        case "nhi_card":
            {
                const { card } = reader;
                return {
                    name: reader.name,
                    state: reader.state,
                    card: {
                        readerName: reader.name,
                        cardNo: card.card_no,
                        fullName: card.full_name,
                        idNo: card.id_no,
                        birthday: new Date(card.birth_date_timestamp),
                        sex: card.sex,
                        issueDate: new Date(card.issue_date_timestamp)
                    },
                    error: null
                };
            }
        case "error":
            return {
                name: reader.name,
                state: reader.state,
                card: null,
                error: reader.error
            };
        default:
            return {
                name: reader.name,
                state: reader.state,
                card: null,
                error: null
            };
    }
};
/** 把 `GET /` 回傳的 JSON 轉成 `Snapshot`。格式不符時回傳 `null`。 */ const toSnapshot = (value)=>{
    if (!isRawSnapshot(value)) {
        return null;
    }
    return {
        status: value.status,
        error: value.error,
        readers: value.readers.map(toReader)
    };
};
/**
 * 解析 WebSocket 的文字訊息。
 *
 * 不是 snapshot 的訊息會回傳 `null`，讓服務之後可以新增其它種類的訊息。
 *
 * @throws {ResponseError} 訊息的格式不符。
 */ const parseMessage = (message)=>{
    let value;
    try {
        value = JSON.parse(message);
    } catch (error) {
        throw new ResponseError("The message is not valid JSON.", {
            cause: error
        });
    }
    if (isObject(value) && typeof value.type === "string" && value.type !== "snapshot") {
        return null;
    }
    const snapshot = toSnapshot(value);
    if (snapshot === null) {
        throw new ResponseError(UNEXPECTED_RESPONSE);
    }
    return snapshot;
};
/** 把 `GET /version` 回傳的 JSON 轉成 `Version`。格式不符時回傳 `null`。 */ const toVersion = (value)=>{
    if (!isObject(value)) {
        return null;
    }
    const { major, minor, patch, pre, text } = value;
    if (typeof major !== "number" || typeof minor !== "number" || typeof patch !== "number" || typeof pre !== "string" || typeof text !== "string") {
        return null;
    }
    return {
        major,
        minor,
        patch,
        pre,
        text
    };
};

/** `setTimeout` 可以接受的最大延遲（毫秒），超過的話會被當成立即執行。 */ const MAX_DELAY = 2147483647;
/**
 * 檢查 `value` 是否為 `min` 到 `max` 之間的數字。
 *
 * @throws {TypeError} `value` 不是數字。
 * @throws {RangeError} `value` 超出範圍，或是 `integer` 為 `true` 時不是整數。
 */ const validateNumber = (name, value, min, max, integer = false)=>{
    // JavaScript 的呼叫端可以傳入任何型別
    if (typeof value !== "number") {
        throw new TypeError(`\`${name}\` must be a number, but its type is ${typeof value}.`);
    }
    if (!(value >= min && value <= max) || integer && !Number.isInteger(value)) {
        throw new RangeError(`\`${name}\` must be ${integer ? "an integer" : "a number"} from ${min} to ${max}, but it is ${value}.`);
    }
    return value;
};




const MIN_INTERVAL = 1;
const MAX_INTERVAL = 86400;
/**
 * 以 WebSocket 監看所有讀卡機的狀態。請使用 `TWNHIICCService` 的 `watch` 方法建立。
 *
 * 第一次連線失敗或之後斷線時都會自動重新連線，直到呼叫 `close` 方法為止。
 */ class SnapshotWatcher {
    #url;
    #retryDelay;
    #onSnapshot;
    #onConnectionChange;
    #onError;
    #interval;
    #socket = null;
    #connected = false;
    #snapshot = null;
    // 這次連線最後一筆 snapshot 的原始 JSON，用來略過內容相同的心跳訊息
    #lastMessage = null;
    #aliveTimer;
    #retryTimer;
    #closed = false;
    /**
     * @param url WebSocket 端點的網址。
     * @throws {TypeError} `interval` 或 `retryDelay` 不是數字。
     * @throws {RangeError} `interval` 或 `retryDelay` 超出範圍。
     */ constructor(url, options = {}){
        const { interval = 3, retryDelay = 1000, onSnapshot, onConnectionChange, onError } = options;
        this.#interval = validateNumber("interval", interval, MIN_INTERVAL, MAX_INTERVAL, true);
        this.#retryDelay = validateNumber("retryDelay", retryDelay, 0, MAX_DELAY);
        this.#url = new URL(url);
        this.#onSnapshot = onSnapshot;
        this.#onConnectionChange = onConnectionChange;
        this.#onError = onError;
        this.#connect();
    }
    /** 是否已連上服務。 */ get connected() {
        return this.#connected;
    }
    /** 最新的讀卡狀態。還沒收到或沒有連上服務時為 `null`。 */ get snapshot() {
        return this.#snapshot;
    }
    /** 讀卡狀態沒有變化時，服務重送目前狀態的時間間隔（秒）。 */ get interval() {
        return this.#interval;
    }
    /**
     * 變更 `interval`。已連上服務時會立即送出，否則會在連上後生效。
     *
     * @throws {TypeError} `seconds` 不是數字。
     * @throws {RangeError} `seconds` 不是 1 到 86400 的整數。
     */ setInterval(seconds) {
        this.#interval = validateNumber("interval", seconds, MIN_INTERVAL, MAX_INTERVAL, true);
        const socket = this.#socket;
        if (this.#connected && socket !== null) {
            socket.send(String(seconds));
            this.#resetAliveTimer();
        }
    }
    /** 關閉連線並停止重新連線。之後不會再呼叫任何 callback。 */ close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        clearTimeout(this.#retryTimer);
        this.#dropSocket();
        this.#connected = false;
        this.#snapshot = null;
    }
    #connect() {
        const interval = this.#interval;
        const url = new URL(this.#url);
        url.searchParams.set("interval", String(interval));
        const socket = new WebSocket(url);
        this.#socket = socket;
        this.#lastMessage = null;
        this.#resetAliveTimer();
        // 被丟棄的 socket 之後仍可能觸發事件，所以每個事件都要先確認它還是目前的 socket
        socket.addEventListener("open", ()=>{
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
        socket.addEventListener("message", (event)=>{
            if (socket !== this.#socket) {
                return;
            }
            this.#handleMessage(event);
        });
        // 連線失敗時也會觸發 `close`
        socket.addEventListener("close", ()=>{
            if (socket !== this.#socket) {
                return;
            }
            this.#reconnect();
        });
    }
    #handleMessage(event) {
        this.#resetAliveTimer();
        const data = event.data;
        // 服務只會送出文字訊息
        if (typeof data !== "string" || data === this.#lastMessage) {
            return;
        }
        let snapshot;
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
    #reconnect() {
        const connected = this.#connected;
        this.#dropSocket();
        this.#connected = false;
        this.#snapshot = null;
        this.#retryTimer = setTimeout(()=>{
            this.#retryTimer = undefined;
            this.#connect();
        }, this.#retryDelay);
        if (connected) {
            this.#onConnectionChange?.(false);
        }
    }
    #dropSocket() {
        clearTimeout(this.#aliveTimer);
        this.#aliveTimer = undefined;
        const socket = this.#socket;
        if (socket !== null) {
            this.#socket = null;
            socket.close();
        }
    }
    // 服務在讀卡狀態沒有變化時，每隔 `interval` 秒會重送一次，所以超過兩倍的時間都沒有收到訊息就當作連線已中斷（也涵蓋卡在連線中的情況）
    #resetAliveTimer() {
        clearTimeout(this.#aliveTimer);
        this.#aliveTimer = setTimeout(()=>{
            this.#aliveTimer = undefined;
            this.#reconnect();
        }, this.#interval * 2000);
    }
}





const fetchJSON = async (url, options, defaultTimeout)=>{
    const { timeout = defaultTimeout, signal } = options;
    const validTimeout = timeout === null ? undefined : validateNumber("timeout", timeout, 0, MAX_DELAY);
    const timeoutSignal = typeof validTimeout === "undefined" ? undefined : AbortSignal.timeout(validTimeout);
    const signals = [];
    if (typeof timeoutSignal !== "undefined") {
        signals.push(timeoutSignal);
    }
    if (typeof signal !== "undefined") {
        signals.push(signal);
    }
    // 依照被中止的是哪個 signal，分辨是使用者取消還是逾時
    const toError = (error, message)=>{
        if (signal?.aborted === true) {
            return signal.reason;
        }
        if (typeof validTimeout !== "undefined" && timeoutSignal?.aborted === true) {
            return new TimeoutError(validTimeout);
        }
        return new NetworkError(message, {
            cause: error
        });
    };
    let response;
    try {
        response = await fetch(url, {
            signal: AbortSignal.any(signals)
        });
    } catch (error) {
        throw toError(error, `Cannot connect to ${url.href}.`);
    }
    const { status } = response;
    if (status !== 200) {
        // 不讀取 body 時要取消它，才能釋放連線
        response.body?.cancel().catch(()=>undefined);
        throw new ResponseError(`The service responded with status ${status}.`, {
            status
        });
    }
    let data;
    try {
        data = await response.json();
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new ResponseError("The response is not valid JSON.", {
                cause: error,
                status
            });
        }
        throw toError(error, `Cannot read the response from ${url.href}.`);
    }
    return {
        status,
        data
    };
};
/** TW NHI IC Card Service 的客戶端。 */ class TWNHIICCService {
    /** TW NHI IC Card Service 的網址前綴。 */ urlPrefix;
    #snapshotURL;
    #versionURL;
    #webSocketURL;
    /** @param urlPrefix TW NHI IC Card Service 的網址前綴，可以包含路徑。預設值：`http://127.0.0.1:12345` */ constructor(urlPrefix = "http://127.0.0.1:12345"){
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
     */ async getVersion(options = {}) {
        const { status, data } = await fetchJSON(this.#versionURL, options, 5000);
        const version = toVersion(data);
        if (version === null) {
            throw new ResponseError(UNEXPECTED_RESPONSE, {
                status
            });
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
     */ async getSnapshot(options = {}) {
        const { status, data } = await fetchJSON(this.#snapshotURL, options, 10000);
        const snapshot = toSnapshot(data);
        if (snapshot === null) {
            throw new ResponseError(UNEXPECTED_RESPONSE, {
                status
            });
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
     */ async getCardList(options = {}) {
        const snapshot = await this.getSnapshot(options);
        return snapshot.readers.flatMap((reader)=>reader.state === "nhi_card" ? [
                reader.card
            ] : []);
    }
    /**
     * 以 WebSocket 監看所有讀卡機的狀態。
     *
     * 會立即開始連線，第一次連線失敗或之後斷線時都會自動重新連線。不用時記得呼叫 `close` 方法。
     *
     * @throws {TypeError} `interval` 或 `retryDelay` 不是數字。
     * @throws {RangeError} `interval` 或 `retryDelay` 超出範圍。
     */ watch(options = {}) {
        return new SnapshotWatcher(this.#webSocketURL, options);
    }
}






export { NetworkError, ResponseError, Sex, SnapshotWatcher, TWNHIICCService, TimeoutError };
