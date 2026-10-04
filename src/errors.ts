/** 無法連線到 TW NHI IC Card Service 時的錯誤。原始的錯誤放在 `cause`。 */
export class NetworkError extends Error {
    override readonly name: string = "NetworkError";
}

/** 請求逾時的錯誤。 */
export class TimeoutError extends NetworkError {
    override readonly name: string = "TimeoutError";

    /** 逾時時間（毫秒）。 */
    readonly timeout: number;

    constructor(timeout: number) {
        super(`The request did not finish within ${timeout} ms.`);

        this.timeout = timeout;
    }
}

/** 服務回應的內容無法使用時的錯誤，例如 HTTP 狀態碼不是 200，或是 JSON 的格式不符。 */
export class ResponseError extends Error {
    override readonly name: string = "ResponseError";

    /** HTTP 狀態碼。WebSocket 訊息的錯誤沒有狀態碼，為 `undefined`。 */
    readonly status: number | undefined;

    constructor(message: string, options: ErrorOptions & { status?: number } = {}) {
        super(message, options);

        this.status = options.status;
    }
}
