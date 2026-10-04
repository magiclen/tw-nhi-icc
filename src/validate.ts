/** `setTimeout` 可以接受的最大延遲（毫秒），超過的話會被當成立即執行。 */
export const MAX_DELAY = 2_147_483_647;

/**
 * 檢查 `value` 是否為 `min` 到 `max` 之間的數字。
 *
 * @throws {TypeError} `value` 不是數字。
 * @throws {RangeError} `value` 超出範圍，或是 `integer` 為 `true` 時不是整數。
 */
export const validateNumber = (
    name: string,
    value: number,
    min: number,
    max: number,
    integer = false,
): number => {
    // JavaScript 的呼叫端可以傳入任何型別
    if (typeof value !== "number") {
        throw new TypeError(`\`${name}\` must be a number, but its type is ${typeof value}.`);
    }

    if (!(value >= min && value <= max) || (integer && !Number.isInteger(value))) {
        throw new RangeError(
            `\`${name}\` must be ${integer ? "an integer" : "a number"} from ${min} to ${max}, but it is ${value}.`,
        );
    }

    return value;
};
