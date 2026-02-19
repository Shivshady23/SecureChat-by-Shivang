import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../src/app.js";

let httpRequest;
let authToken;

before(() => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-secret";
  const app = createApp({
    corsOrigin: (origin, callback) => callback(null, true)
  });
  httpRequest = request(app);
  authToken = jwt.sign({ id: "507f1f77bcf86cd799439011" }, process.env.JWT_SECRET);
});

describe("API guardrails", () => {
  it("returns health response", async () => {
    const res = await httpRequest.get("/");
    assert.equal(res.status, 200);
    assert.equal(res.body?.status, "ok");
  });

  it("rejects invalid username format on register", async () => {
    const res = await httpRequest.post("/api/auth/register").send({
      name: "Test User",
      username: "bad username",
      password: "StrongPass123!"
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body?.message || ""), /username/i);
  });

  it("rejects short password on register", async () => {
    const res = await httpRequest.post("/api/auth/register").send({
      name: "Test User",
      username: "valid_user",
      password: "123"
    });
    assert.equal(res.status, 400);
    assert.match(String(res.body?.message || ""), /password/i);
  });

  it("blocks traversal-like upload key requests", async () => {
    const res = await httpRequest
      .get("/api/upload/not-valid-key")
      .set("Authorization", `Bearer ${authToken}`);
    assert.equal(res.status, 400);
    assert.match(String(res.body?.message || ""), /invalid file key/i);
  });

  it("rejects invalid image upload types", async () => {
    const res = await httpRequest
      .post("/api/upload")
      .set("Authorization", `Bearer ${authToken}`)
      .field("uploadType", "image")
      .field("originalName", "document.pdf")
      .field("originalMimeType", "application/pdf")
      .attach("file", Buffer.from("fake-pdf-bytes"), {
        filename: "document.pdf",
        contentType: "application/pdf"
      });

    assert.equal(res.status, 400);
    assert.match(String(res.body?.message || ""), /jpg|jpeg|png|webp|gif/i);
  });
});
