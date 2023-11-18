/**
 * 網路錯誤。
 */
export declare class NetworkError extends Error {
    constructor(error: Error | string);
}
/**
 * 逾時錯誤。
 */
export declare class TimeoutError extends NetworkError {
    constructor(message: string);
}
