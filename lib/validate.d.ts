/** `setTimeout` 可以接受的最大延遲（毫秒），超過的話會被當成立即執行。 */
export declare const MAX_DELAY = 2147483647;
/**
 * 檢查 `value` 是否為 `min` 到 `max` 之間的數字。
 *
 * @throws {TypeError} `value` 不是數字。
 * @throws {RangeError} `value` 超出範圍，或是 `integer` 為 `true` 時不是整數。
 */
export declare const validateNumber: (name: string, value: number, min: number, max: number, integer?: boolean) => number;
