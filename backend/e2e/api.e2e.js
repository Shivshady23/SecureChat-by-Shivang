// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import assert from "node:assert/strict";

const BASE_URL = (process.env.E2E_BASE_URL || "http://localhost:5001").replace(/\/$/, "");

function makeUser(prefix) {
  const seed = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    name: `${prefix}-${seed}`,
    username: `${prefix}_${seed}`,
    password: "Test123!",
    publicKeyJwk: { kty: "RSA" }
  };
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: res.status, data };
}

function expectStatus(actual, expected, label, payload) {
  assert.equal(
    actual,
    expected,
    `${label} failed: expected ${expected}, got ${actual}. Response: ${JSON.stringify(payload)}`
  );
}

async function run() {
  console.log(`Running E2E suite against ${BASE_URL}`);

  const alice = makeUser("alice");
  const bob = makeUser("bob");

  let aliceToken;
  let bobToken;
  let chatId;
  let groupChatId;
  let messageId;

  try {
    const health = await api("/");
    expectStatus(health.status, 200, "Health check", health.data);
    assert.equal(health.data?.status, "ok", "Health payload mismatch");

    const registerAlice = await api("/api/auth/register", {
      method: "POST",
      body: alice
    });
    expectStatus(registerAlice.status, 200, "Register Alice", registerAlice.data);
    aliceToken = registerAlice.data?.token;
    assert.ok(aliceToken, "Alice token missing after register");

    const loginAlice = await api("/api/auth/login", {
      method: "POST",
      body: { username: alice.username, password: alice.password }
    });
    expectStatus(loginAlice.status, 200, "Login Alice", loginAlice.data);

    const registerBob = await api("/api/auth/register", {
      method: "POST",
      body: bob
    });
    expectStatus(registerBob.status, 200, "Register Bob", registerBob.data);
    bobToken = registerBob.data?.token;
    assert.ok(bobToken, "Bob token missing after register");

    const usersForAlice = await api("/api/users", { token: aliceToken });
    expectStatus(usersForAlice.status, 200, "List users", usersForAlice.data);
    const bobFromList = usersForAlice.data?.users?.find((u) => u.username === bob.username);
    assert.ok(bobFromList?._id, "Bob not found in Alice user list");

    const sendRequest = await api("/api/requests", {
      method: "POST",
      token: aliceToken,
      body: { toUserId: bobFromList._id }
    });
    expectStatus(sendRequest.status, 200, "Send chat request", sendRequest.data);
    assert.ok(sendRequest.data?.request?._id, "Request id missing after sending chat request");

    const bobRequests = await api("/api/requests", { token: bobToken });
    expectStatus(bobRequests.status, 200, "Bob list requests", bobRequests.data);
    const incoming = bobRequests.data?.incoming?.find((r) => r.from?.username === alice.username);
    assert.ok(incoming?._id, "Incoming request for Bob not found");

    const accept = await api(`/api/requests/${incoming._id}/respond`, {
      method: "POST",
      token: bobToken,
      body: { status: "accepted" }
    });
    expectStatus(accept.status, 200, "Accept request", accept.data);
    chatId = accept.data?.chat?._id;
    assert.ok(chatId, "Chat id missing after acceptance");

    const aliceChats = await api("/api/chats", { token: aliceToken });
    expectStatus(aliceChats.status, 200, "List chats", aliceChats.data);
    assert.ok(aliceChats.data?.chats?.some((c) => c._id === chatId), "Accepted chat missing from Alice chat list");

    const createGroup = await api("/api/chats/group", {
      method: "POST",
      token: aliceToken,
      body: {
        name: "e2e-group",
        memberIds: [bobFromList._id]
      }
    });
    expectStatus(createGroup.status, 200, "Create group", createGroup.data);
    groupChatId = createGroup.data?.chat?._id;
    assert.ok(groupChatId, "Group chat id missing");

    const sendMessage = await api(`/api/messages/${groupChatId}`, {
      method: "POST",
      token: aliceToken,
      body: { type: "text", content: "hello from e2e" }
    });
    expectStatus(sendMessage.status, 200, "Send message", sendMessage.data);
    messageId = sendMessage.data?.message?._id;
    assert.ok(messageId, "Message id missing after sending message");

    const listMessages = await api(`/api/messages/${groupChatId}`, { token: bobToken });
    expectStatus(listMessages.status, 200, "List messages", listMessages.data);
    assert.ok(listMessages.data?.messages?.some((m) => m._id === messageId), "Bob cannot see Alice message in chat");

    const read = await api(`/api/messages/${groupChatId}/read`, {
      method: "POST",
      token: bobToken,
      body: { messageIds: [messageId] }
    });
    expectStatus(read.status, 200, "Read message", read.data);
    assert.equal(typeof read.data?.updated, "number", "Read response must include numeric updated count");

    console.log("E2E suite passed");
  } finally {
    if (aliceToken) {
      await api("/api/users/me", { method: "DELETE", token: aliceToken });
    }
    if (bobToken) {
      await api("/api/users/me", { method: "DELETE", token: bobToken });
    }
  }
}

run().catch((err) => {
  console.error("E2E suite failed");
  console.error(err?.stack || err);
  process.exit(1);
});

