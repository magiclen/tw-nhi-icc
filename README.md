TW NHI IC Card
====================

[![CI](https://github.com/magiclen/tw-nhi-icc/actions/workflows/ci.yml/badge.svg)](https://github.com/magiclen/tw-nhi-icc/actions/workflows/ci.yml)

在 JavaScript/TypeScript 中，讀取中華民國健保卡。

Read Taiwan NHI cards in JavaScript/TypeScript.

## 用法

#### 執行環境

請先取得並在本地端或是某處執行 0.3.0 以上版本的 [TW NHI IC Card Service](https://github.com/magiclen/tw-nhi-icc-service)。

本套件可以在網頁瀏覽器與 Node.js 24 以上的版本中使用。

#### 撰寫程式

###### 使用 npm 安裝本套件

```bash
npm install "git+https://github.com/magiclen/tw-nhi-icc.git#semver:^0.2"
```

###### 初始化

```typescript
import { TWNHIICCService } from "tw-nhi-icc";

// 預設會連到 http://127.0.0.1:12345
const service = new TWNHIICCService();
```

###### 取得 TW NHI IC Card Service 的版本資訊

```typescript
const version = await service.getVersion();
```

###### 取得健保卡清單

```typescript
const cards = await service.getCardList();

for (const card of cards) {
    console.log(card.readerName, card.fullName, card.idNo);
}
```

###### 取得所有讀卡機的狀態

`getCardList` 只會回傳讀到的健保卡。若要知道服務與每台讀卡機的狀態（例如沒有插卡、插的不是健保卡、讀卡失敗），請使用 `getSnapshot`。

```typescript
const snapshot = await service.getSnapshot();

if (snapshot.status === "pcsc_unavailable") {
    console.error(`PC/SC 服務無法使用：${snapshot.error}`);
}

for (const reader of snapshot.readers) {
    switch (reader.state) {
        case "nhi_card":
            console.log(reader.name, reader.card.fullName);
            break;
        case "empty":
            console.log(reader.name, "沒有插卡");
            break;
        case "unsupported_card":
            console.log(reader.name, "不是健保卡");
            break;
        case "error":
            console.log(reader.name, `讀卡失敗：${reader.error}`);
            break;
    }
}
```

###### 即時監看讀卡機

`watch` 會透過 WebSocket 連到服務，在插拔卡片時立即通知。第一次連線失敗或之後斷線時都會自動重新連線。

```typescript
const watcher = service.watch({
    onSnapshot: (snapshot) => {
        // 每次連上服務後的第一筆讀卡狀態，以及之後讀卡狀態改變時
    },
    onConnectionChange: (connected) => {
        // 連上服務或與服務斷線時
    },
});

// 不用時要關閉
watcher.close();
```

- `interval`：讀卡狀態沒有變化時，服務重送目前狀態的時間間隔（秒），範圍為 1 到 86400 的整數，預設為 `3`。超過兩倍的 `interval` 都沒有收到訊息時，會當作連線已中斷並重新連線。之後可以用 `watcher.setInterval(seconds)` 變更。
- `retryDelay`：斷線後要等多久才重新連線（毫秒），預設為 `1000`。
- `onError`：收到無法解析的訊息時（例如服務的版本在 0.3.0 以前）會呼叫。
- `watcher.connected` 與 `watcher.snapshot` 可以取得目前的連線狀態與最新的讀卡狀態。

###### 日期

`birthday` 與 `issueDate` 是 `Date` 物件，為台灣時區（UTC+8）當天午夜的時間。要取得日期時請指定時區，否則在其它時區可能會差一天。

```typescript
card.birthday.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }); // 1990/1/1
```

###### 逾時與取消

`getVersion` 預設 5 秒逾時，`getSnapshot` 與 `getCardList` 預設 10 秒逾時。可以用 `timeout`（毫秒，`null` 代表不限制）與 `signal` 改變。

```typescript
const controller = new AbortController();

const cards = await service.getCardList({ timeout: 3000, signal: controller.signal });
```

###### 錯誤處理

```typescript
import { NetworkError, ResponseError, TimeoutError } from "tw-nhi-icc";

try {
    const cards = await service.getCardList();
} catch (error) {
    if (error instanceof TimeoutError) {
        // 逾時（TimeoutError 也是一種 NetworkError）
    } else if (error instanceof NetworkError) {
        // 無法連線到服務，例如服務沒有在執行
    } else if (error instanceof ResponseError) {
        // 服務回應的內容無法使用，例如服務的版本在 0.3.0 以前，`error.status` 為 HTTP 狀態碼
    } else {
        throw error;
    }
}
```

若服務有以 `--allow-origin` 啟動，只有被允許的網頁來源才能使用此服務。

## 網頁瀏覽器的用法

`dist/tw-nhi-icc.min.js` 會提供全域變數 `TWNHIICC`。

```html
<script src="https://cdn.jsdelivr.net/gh/magiclen/tw-nhi-icc/dist/tw-nhi-icc.min.js"></script>
<script>
    const service = new TWNHIICC.TWNHIICCService();
</script>
```

[Source](demo.html)

[Demo Page](https://rawcdn.githack.com/magiclen/tw-nhi-icc/master/demo.html)

## 從 0.1.x 遷移

- 需要 0.3.0 以上版本的 TW NHI IC Card Service，以及 Node.js 24 以上的版本。
- `getVersion(timeout)` 與 `getCardList(timeout)` 改為 `getVersion({ timeout })` 與 `getCardList({ timeout })`。
- `birthday` 與 `issueDate` 固定為台灣時區（UTC+8）當天午夜的時間，舊版的服務則是使用伺服器的時區。
- `openWebSocket`、`closeWebSocket`、`isWebSocketRunning`、`setWebSocketInterval`、`onWebSocketUpdate`、`onWebSocketRetry` 改為 `watch` 與它回傳的 `SnapshotWatcher`。`onSnapshot` 只在讀卡狀態改變時才會呼叫，不會每隔 `interval` 秒呼叫一次。
- `Sex` 從 `const enum` 改為一般的物件，`Sex.M` 與 `Sex.F` 可以照常使用。
- `NetworkError` 與 `TimeoutError` 的建構子改變了，原始的錯誤放在 `cause`。另外新增了 `ResponseError`。
- 網頁瀏覽器中的全域變數 `TWNHIICCService`、`NetworkError` 等，改為 `TWNHIICC.TWNHIICCService`、`TWNHIICC.NetworkError` 等。

## License

[MIT](LICENSE)
