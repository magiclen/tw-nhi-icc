import { ResponseError } from "./errors.ts";

/** 性別。 */
export const Sex = {
    /** 男。 */
    M: "M",
    /** 女。 */
    F: "F",
} as const;

/** 性別。`"M"` 為男，`"F"` 為女。 */
export type Sex = (typeof Sex)[keyof typeof Sex];

/** 健保卡的基本資料。 */
export interface NHICard {
    /** 讀卡機名稱。 */
    readerName: string;
    /** 卡號。 */
    cardNo: string;
    /** 全名。無法以 Big5 解碼的字（例如部分罕用字）會以 U+FFFD（`�`）取代。 */
    fullName: string;
    /** 身份證字號。 */
    idNo: string;
    /**
     * 生日，為台灣時區（UTC+8）當天午夜的時間。
     *
     * 要取得日期時請指定時區，例如 `birthday.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })`。
     */
    birthday: Date;
    /** 性別。 */
    sex: Sex;
    /**
     * 發卡日期，為台灣時區（UTC+8）當天午夜的時間。
     *
     * 要取得日期時請指定時區，例如 `issueDate.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })`。
     */
    issueDate: Date;
}

/**
 * 一台讀卡機。可以用 `state` 判斷其它欄位是否有值。
 *
 * - `name`：讀卡機名稱。
 * - `state`：讀卡機的狀態。
 *
 *   - `"empty"`：沒有插卡。
 *   - `"nhi_card"`：讀到健保卡，資料在 `card`。
 *   - `"unsupported_card"`：有卡片，但不是健保卡（例如 SAM 卡或晶片金融卡）。
 *   - `"error"`：讀卡失敗，PC/SC 的錯誤名稱在 `error`，例如：
 *
 *       - `SharingViolation`：卡片正被其它程式獨占使用，服務會自動重試。
 *       - `ReaderUnavailable`：讀卡機目前無法使用，恢復後狀態會自動更新。
 * - `card`：健保卡的基本資料。只有 `state` 為 `"nhi_card"` 時才有值，否則為 `null`。
 * - `error`：PC/SC 的錯誤名稱。只有 `state` 為 `"error"` 時才有值，否則為 `null`。
 */
export type Reader =
    | { name: string; state: "nhi_card"; card: NHICard; error: null }
    | { name: string; state: "empty" | "unsupported_card"; card: null; error: null }
    | { name: string; state: "error"; card: null; error: string };

/** 讀卡機的狀態。 */
export type ReaderState = Reader["state"];

/**
 * 服務的狀態。
 *
 * - `"ok"`：PC/SC 服務可以使用。
 * - `"pcsc_unavailable"`：PC/SC 服務無法使用。服務會自動重試，恢復後就會變回 `"ok"`。
 */
export type ServiceStatus = "ok" | "pcsc_unavailable";

/** 所有讀卡機在某個時間點的狀態。 */
export interface Snapshot {
    /** 服務的狀態。 */
    status: ServiceStatus;
    /** PC/SC 的錯誤名稱（例如 `NoService`）。只有 `status` 為 `"pcsc_unavailable"` 時才有值，否則為 `null`。 */
    error: string | null;
    /** 所有讀卡機。`status` 為 `"pcsc_unavailable"` 時為空陣列。 */
    readers: Reader[];
}

/** TW NHI IC Card Service 的版本資訊。 */
export interface Version {
    major: number;
    minor: number;
    patch: number;
    /** 預發布版本的標籤，沒有時為空字串。 */
    pre: string;
    /** 完整的版本字串，例如 `0.3.0`。 */
    text: string;
}

interface RawNHICard {
    card_no: string;
    full_name: string;
    id_no: string;
    birth_date_timestamp: number;
    sex: Sex;
    issue_date_timestamp: number;
}

type RawReader =
    | { name: string; state: "nhi_card"; card: RawNHICard; error: null }
    | { name: string; state: "empty" | "unsupported_card"; card: null; error: null }
    | { name: string; state: "error"; card: null; error: string };

interface RawSnapshot {
    type: "snapshot";
    status: ServiceStatus;
    error: string | null;
    readers: RawReader[];
}

export const UNEXPECTED_RESPONSE =
    "The response is not in the expected format. TW NHI IC Card Service 0.3.0 or later is required.";

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

// 只檢查最外層，其餘的欄位相信服務
const isRawSnapshot = (value: unknown): value is RawSnapshot =>
    isObject(value) && value.type === "snapshot" && Array.isArray(value.readers);

const toReader = (reader: RawReader): Reader => {
    switch (reader.state) {
        case "nhi_card": {
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
                    issueDate: new Date(card.issue_date_timestamp),
                },
                error: null,
            };
        }
        case "error":
            return { name: reader.name, state: reader.state, card: null, error: reader.error };
        default:
            return { name: reader.name, state: reader.state, card: null, error: null };
    }
};

/** 把 `GET /` 回傳的 JSON 轉成 `Snapshot`。格式不符時回傳 `null`。 */
export const toSnapshot = (value: unknown): Snapshot | null => {
    if (!isRawSnapshot(value)) {
        return null;
    }

    return {
        status: value.status,
        error: value.error,
        readers: value.readers.map(toReader),
    };
};

/**
 * 解析 WebSocket 的文字訊息。
 *
 * 不是 snapshot 的訊息會回傳 `null`，讓服務之後可以新增其它種類的訊息。
 *
 * @throws {ResponseError} 訊息的格式不符。
 */
export const parseMessage = (message: string): Snapshot | null => {
    let value: unknown;

    try {
        value = JSON.parse(message);
    } catch (error) {
        throw new ResponseError("The message is not valid JSON.", { cause: error });
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

/** 把 `GET /version` 回傳的 JSON 轉成 `Version`。格式不符時回傳 `null`。 */
export const toVersion = (value: unknown): Version | null => {
    if (!isObject(value)) {
        return null;
    }

    const { major, minor, patch, pre, text } = value;

    if (
        typeof major !== "number" ||
        typeof minor !== "number" ||
        typeof patch !== "number" ||
        typeof pre !== "string" ||
        typeof text !== "string"
    ) {
        return null;
    }

    return { major, minor, patch, pre, text };
};
