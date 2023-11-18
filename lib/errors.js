/**
 * 網路錯誤。
 */
export class NetworkError extends Error {
    constructor(error) {
        if (error instanceof Error) {
            super(error.message);
            this.stack = error.stack;
        }
        else {
            super(error);
        }
        this.name = "NetworkError";
    }
}
/**
 * 逾時錯誤。
 */
export class TimeoutError extends NetworkError {
    constructor(message) {
        super(message);
        this.name = "TimeoutError";
    }
}
