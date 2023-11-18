import { WebSocket } from "ws";

import { NetworkError, TWNHIICCService, TimeoutError } from "../src/lib.js";

Object.assign(global, { WebSocket: WebSocket });

describe("TWNHIICCService (with correct URL prefix)", () => {
    let service: TWNHIICCService;

    beforeAll(() => {
        service = new TWNHIICCService();
    });

    afterAll(() => {
        service.closeWebSocket();
    });

    describe("GET /version", () => {
        it("it should success", async () => {
            const version = await service.getVersion();

            expect(typeof version.text).toBe("string");
        });

        it("it should timeout", async () => {
            await expect(service.getVersion(0)).rejects.toThrow(TimeoutError);
        });
    });

    describe("GET /", () => {
        it("it should success", async () => {
            const cardList = await service.getCardList();

            expect(Array.isArray(cardList)).toBe(true);
        });

        it("it should timeout", async () => {
            await expect(service.getCardList(0)).rejects.toThrow(TimeoutError);
        });
    });

    describe("GET /ws", () => {
        it("it should success", async () => {
            await service.openWebSocket();

            const promis = new Promise((resolve) => {
                service.onWebSocketUpdate = (cards) => {
                    resolve(Array.isArray(cards));
                };
            });
            
            await expect(promis).resolves.toBe(true);
        });
    });
});

describe("TWNHIICCService (with incorrect URL prefix)", () => {
    let service: TWNHIICCService;

    beforeAll(() => {
        service = new TWNHIICCService("http://127.0.0.1:54321");
    });

    describe("GET /version", () => {
        it("it should occur NetworkError", async () => {
            await expect(service.getVersion()).rejects.toThrow(NetworkError);
        });
    });

    describe("GET /", () => {
        it("it should occur NetworkError", async () => {
            await expect(service.getCardList()).rejects.toThrow(NetworkError);
        });
    });

    describe("GET /ws", () => {
        it("it should occur NetworkError", async () => {
            await expect(service.openWebSocket()).rejects.toThrow(NetworkError);
        });
    });
});
