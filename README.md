TW NHI IC Card
====================

[![CI](https://github.com/magiclen/tw-nhi-icc/actions/workflows/ci.yml/badge.svg)](https://github.com/magiclen/tw-nhi-icc/actions/workflows/ci.yml)

在 JavaScript/TypeScript 中，讀取中華民國健保卡。

Read Taiwan NHI cards in JavaScript/TypeScript.

## 用法

#### 執行環境

請先取得並在本地端或是某處執行 [TW NHI IC Card Service](https://github.com/magiclen/tw-nhi-icc-service)。

#### 撰寫程式

###### 使用 npm 安裝本套件

```bash
npm install "git+https://github.com/magiclen/tw-nhi-icc.git#semver:^0.1"
```

###### 初始化

```typescript
import { TWNHIICCService } from "tw-nhi-icc";

const service = new TWNHIICCService();
```

###### 取得 TW NHI IC Card Service 的版本資訊

```typescript
const version = service.getVersion();
```

###### 取得健保卡清單

```typescript
const cards = await service.getCardList();
```

###### 連接 WebSocket

```typescript
await service.openWebSocket();

service.onWebSocketUpdate = (cards) => {
    // ...
};

service.closeWebSocket();
```

## 網頁瀏覽器的用法

[Source](demo.html)

[Demo Page](https://rawcdn.githack.com/magiclen/tw-nhi-icc/master/demo.html)

## License

[MIT](LICENSE)