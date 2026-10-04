/** 無法連線到 TW NHI IC Card Service 時的錯誤。原始的錯誤放在 `cause`。 */
export declare class NetworkError extends Error {
    readonly name: string;
}
/** 請求逾時的錯誤。 */
export declare class TimeoutError extends NetworkError {
    readonly name: string;
    /** 逾時時間（毫秒）。 */
    readonly timeout: number;
    constructor(timeout: number);
}
/** 服務回應的內容無法使用時的錯誤，例如 HTTP 狀態碼不是 200，或是 JSON 的格式不符。 */
export declare class ResponseError extends Error {
    readonly name: string;
    /** HTTP 狀態碼。WebSocket 訊息的錯誤沒有狀態碼，為 `undefined`。 */
    readonly status: number | undefined;
    constructor(message: string, options?: ErrorOptions & {
        status?: number;
    });
}
