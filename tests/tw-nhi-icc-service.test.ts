import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { setInterval as every, setTimeout as sleep } from "node:timers/promises";

import type { WebSocket as ServerSocket } from "ws";
import { WebSocketServer } from "ws";

import { NetworkError, TimeoutError, TWNHIICCService } from "../src/index.ts";
import type { NHICard, Snapshot } from "../src/index.ts";

const VERSION = { major: 0, minor: 3, patch: 0, pre: "", text: "0.3.0" };

const RAW_SNAPSHOT = JSON.stringify({
    type: "snapshot",
    status: "ok",
    error: null,
    readers: [
        {
            name: "Reader 0",
            state: "nhi_card",
            card: {
                card_no: "000012345678",
                full_name: "王小明",
                id_no: "A123456789",
                birth_date: "1990-01-01",
                birth_date_timestamp: 631123200000,
                sex: "M",
                issue_date: "2020-01-01",
                issue_date_timestamp: 1577808000000,
            },
            error: null,
        },
        { name: "Reader 1", state: "empty", card: null, error: null },
        { name: "Reader 2", state: "unsupported_card", card: null, error: null },
        { name: "Reader 3", state: "error", card: null, error: "SharingViolation" },
    ],
});

const RAW_EMPTY_SNAPSHOT = JSON.stringify({
    type: "snapshot",
    status: "pcsc_unavailable",
    error: "NoService",
    readers: [],
});

const CARD: NHICard = {
    readerName: "Reader 0",
    cardNo: "000012345678",
    fullName: "王小明",
    idNo: "A123456789",
    birthday: new Date(631123200000),
    sex: "M",
    issueDate: new Date(1577808000000),
};

const SNAPSHOT: Snapshot = {
    status: "ok",
    error: null,
    readers: [
        { name: "Reader 0", state: "nhi_card", card: CARD, error: null },
        { name: "Reader 1", state: "empty", card: null, error: null },
        { name: "Reader 2", state: "unsupported_card", card: null, error: null },
        { name: "Reader 3", state: "error", card: null, error: "SharingViolation" },
    ],
};

const EMPTY_SNAPSHOT: Snapshot = { status: "pcsc_unavailable", error: "NoService", readers: [] };

/** 連到 mock server 的 WebSocket。 */
interface Connection {
    socket: ServerSocket;
    url: URL;
    /** 客戶端送來的訊息。 */
    messages: string[];
    closed: boolean;
}

let server: Server;
let webSocketServer: WebSocketServer;
let urlPrefix: string;
let connections: Connection[] = [];

const listen = async (target: Server): Promise<number> => {
    await new Promise<void>((resolve) => {
        target.listen(0, "127.0.0.1", resolve);
    });

    const address = target.address();

    if (typeof address !== "object" || address === null) {
        throw new Error("the server is not listening on a TCP port");
    }

    return address.port;
};

// 等到 `condition` 成立，超過 `timeout` 毫秒就失敗
const waitUntil = async (condition: () => boolean, timeout = 3000): Promise<void> => {
    const deadline = Date.now() + timeout;

    for await (const _ of every(10)) {
        if (condition()) {
            return;
        }

        if (Date.now() > deadline) {
            throw new Error("timed out waiting for the condition");
        }
    }
};

before(async () => {
    server = createServer((req, res) => {
        switch (req.url) {
            case "/":
                res.setHeader("content-type", "application/json");
                res.end(RAW_SNAPSHOT);
                break;
            case "/version":
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify(VERSION));
                break;
            case "/stall/version":
                // never respond
                break;
            default:
                res.writeHead(404);
                res.end();
        }
    });

    webSocketServer = new WebSocketServer({ server, path: "/ws" });

    webSocketServer.on("connection", (socket, request) => {
        const connection: Connection = {
            socket,
            url: new URL(request.url ?? "", urlPrefix),
            messages: [],
            closed: false,
        };

        socket.on("message", (data) => {
            // 預設的 `binaryType` 是 `"nodebuffer"`，所以收到的是 `Buffer`
            if (Buffer.isBuffer(data)) {
                connection.messages.push(data.toString());
            }
        });

        socket.on("close", () => {
            connection.closed = true;
        });

        connections.push(connection);
    });

    urlPrefix = `http://127.0.0.1:${await listen(server)}`;
});

beforeEach(() => {
    connections = [];
});

after(() => {
    for (const socket of webSocketServer.clients) {
        socket.terminate();
    }

    webSocketServer.close();

    server.closeAllConnections();
    server.close();
});

describe("HTTP", () => {
    it("getVersion", async () => {
        const service = new TWNHIICCService(urlPrefix);

        assert.deepEqual(VERSION, await service.getVersion());
    });

    it("getSnapshot", async () => {
        const service = new TWNHIICCService(urlPrefix);

        assert.deepEqual(SNAPSHOT, await service.getSnapshot());
    });

    it("getCardList", async () => {
        const service = new TWNHIICCService(urlPrefix);

        assert.deepEqual([CARD], await service.getCardList());
    });

    it("timeout", async () => {
        const service = new TWNHIICCService(`${urlPrefix}/stall`);

        await assert.rejects(service.getVersion({ timeout: 100 }), TimeoutError);
    });

    it("network error", async () => {
        // 取得一個沒有在監聽的埠
        const closedServer = createServer();
        const port = await listen(closedServer);

        await new Promise<void>((resolve) => {
            closedServer.close(() => {
                resolve();
            });
        });

        const service = new TWNHIICCService(`http://127.0.0.1:${port}`);

        await assert.rejects(service.getVersion(), NetworkError);
        await assert.rejects(service.getSnapshot(), NetworkError);
    });
});

describe("watch", () => {
    it("snapshots", async (t) => {
        const snapshots: Snapshot[] = [];
        const states: boolean[] = [];

        const watcher = new TWNHIICCService(urlPrefix).watch({
            onSnapshot: (snapshot) => {
                snapshots.push(snapshot);
            },
            onConnectionChange: (connected) => {
                states.push(connected);
            },
        });

        t.after(() => {
            watcher.close();
        });

        await waitUntil(() => states.length === 1);

        assert.deepEqual([true], states);
        assert.equal(true, watcher.connected);
        assert.equal("3", connections[0].url.searchParams.get("interval"));

        connections[0].socket.send(RAW_SNAPSHOT);

        await waitUntil(() => snapshots.length === 1);

        assert.deepEqual([SNAPSHOT], snapshots);
        assert.deepEqual(SNAPSHOT, watcher.snapshot);

        // 內容相同的心跳訊息不會再通知
        connections[0].socket.send(RAW_SNAPSHOT);
        connections[0].socket.send(RAW_EMPTY_SNAPSHOT);

        await waitUntil(() => snapshots.length === 2);

        assert.deepEqual([SNAPSHOT, EMPTY_SNAPSHOT], snapshots);
    });

    it("reconnect", async (t) => {
        const snapshots: Snapshot[] = [];
        const states: boolean[] = [];

        const watcher = new TWNHIICCService(urlPrefix).watch({
            retryDelay: 50,
            onSnapshot: (snapshot) => {
                snapshots.push(snapshot);
            },
            onConnectionChange: (connected) => {
                states.push(connected);
            },
        });

        t.after(() => {
            watcher.close();
        });

        await waitUntil(() => states.length === 1);

        connections[0].socket.send(RAW_SNAPSHOT);

        await waitUntil(() => snapshots.length === 1);

        connections[0].socket.terminate();

        await waitUntil(() => states.length === 3);

        assert.deepEqual([true, false, true], states);
        assert.equal(2, connections.length);

        // 重新連線後的第一筆一定會通知，即使內容沒有變
        connections[1].socket.send(RAW_SNAPSHOT);

        await waitUntil(() => snapshots.length === 2);

        assert.deepEqual([SNAPSHOT, SNAPSHOT], snapshots);
    });

    it("setInterval", async (t) => {
        const states: boolean[] = [];

        const watcher = new TWNHIICCService(urlPrefix).watch({
            interval: 5,
            onConnectionChange: (connected) => {
                states.push(connected);
            },
        });

        t.after(() => {
            watcher.close();
        });

        await waitUntil(() => states.length === 1);

        assert.equal("5", connections[0].url.searchParams.get("interval"));

        watcher.setInterval(10);

        await waitUntil(() => connections[0].messages.length === 1);

        assert.deepEqual(["10"], connections[0].messages);
        assert.equal(10, watcher.interval);
    });

    it("close", async () => {
        const states: boolean[] = [];

        const watcher = new TWNHIICCService(urlPrefix).watch({
            retryDelay: 50,
            onConnectionChange: (connected) => {
                states.push(connected);
            },
        });

        await waitUntil(() => states.length === 1);

        watcher.close();

        await waitUntil(() => connections[0].closed);

        // 超過 `retryDelay` 也不會重新連線
        await sleep(200);

        assert.equal(1, connections.length);
        assert.deepEqual([true], states);
        assert.equal(false, watcher.connected);
    });

    it("reconnect when the service is silent", async (t) => {
        const states: boolean[] = [];

        const watcher = new TWNHIICCService(urlPrefix).watch({
            interval: 1,
            retryDelay: 50,
            onConnectionChange: (connected) => {
                states.push(connected);
            },
        });

        t.after(() => {
            watcher.close();
        });

        await waitUntil(() => states.length === 1);

        // 服務超過 2 秒都沒有送出訊息
        await waitUntil(() => states.length === 3, 4000);

        assert.deepEqual([true, false, true], states);
        assert.equal(2, connections.length);
    });
});
