import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import jwt from "jsonwebtoken";
import { io as ioClient } from "socket.io-client";
import { createApp } from "../src/app.js";
import { initSocket } from "../src/socket/index.js";
import Chat from "../src/models/Chat.js";

let server;
let baseUrl = "";
let restoreFind;

function waitForEvent(socket, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeoutMs);
    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(eventName, onEvent);
  });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-secret";

  restoreFind = Chat.find;
  Chat.find = () => ({
    select: async () => []
  });

  const app = createApp({
    corsOrigin: (origin, callback) => callback(null, true)
  });
  server = http.createServer(app);
  initSocket(server, { origin: (origin, callback) => callback(null, true) });
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Chat.find = restoreFind;
  await new Promise((resolve) => server.close(resolve));
});

describe("Socket signaling room limits", () => {
  it("allows 2 peers and rejects third with room-full", async () => {
    const roomId = `test-room-${Date.now()}`;
    const tokenA = jwt.sign({ id: "507f1f77bcf86cd799439011" }, process.env.JWT_SECRET);
    const tokenB = jwt.sign({ id: "507f1f77bcf86cd799439012" }, process.env.JWT_SECRET);
    const tokenC = jwt.sign({ id: "507f1f77bcf86cd799439013" }, process.env.JWT_SECRET);

    const socketA = ioClient(baseUrl, { transports: ["websocket"], auth: { token: tokenA } });
    const socketB = ioClient(baseUrl, { transports: ["websocket"], auth: { token: tokenB } });
    const socketC = ioClient(baseUrl, { transports: ["websocket"], auth: { token: tokenC } });

    try {
      await Promise.all([
        waitForEvent(socketA, "connect"),
        waitForEvent(socketB, "connect"),
        waitForEvent(socketC, "connect")
      ]);

      const joinA = await new Promise((resolve) =>
        socketA.emit("call-join", { roomId }, (response) => resolve(response))
      );
      assert.equal(joinA?.ok, true);
      assert.equal(joinA?.isInitiator, true);

      const peerJoinedPromise = waitForEvent(socketA, "peer-joined");
      const joinB = await new Promise((resolve) =>
        socketB.emit("call-join", { roomId }, (response) => resolve(response))
      );
      assert.equal(joinB?.ok, true);
      assert.equal(joinB?.isInitiator, false);
      const peerJoined = await peerJoinedPromise;
      assert.equal(String(peerJoined?.roomId), roomId);

      const roomFullPromise = waitForEvent(socketC, "room-full");
      const joinC = await new Promise((resolve) =>
        socketC.emit("call-join", { roomId }, (response) => resolve(response))
      );
      const roomFull = await roomFullPromise;
      assert.equal(joinC?.ok, false);
      assert.equal(joinC?.error, "room-full");
      assert.equal(String(roomFull?.roomId), roomId);
    } finally {
      socketA.disconnect();
      socketB.disconnect();
      socketC.disconnect();
    }
  });
});
