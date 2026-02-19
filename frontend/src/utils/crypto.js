// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import { idbGet, idbSet } from "./keyStore.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function base64ToArrayBuffer(base64) {
  return base64ToBuffer(base64);
}

function keyNames(userId) {
  return {
    privateName: `rsa-private-${userId}`,
    publicName: `rsa-public-${userId}`
  };
}

async function importPublicKeyFromSpkiB64(spkiB64) {
  return crypto.subtle.importKey(
    "spki",
    base64ToBuffer(spkiB64),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt", "wrapKey"]
  );
}

async function importPrivateKeyFromJwk(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt", "unwrapKey"]
  );
}

async function getOrCreateIdentity(userId) {
  const { privateName, publicName } = keyNames(userId);
  const existingPrivateJwk = await idbGet(privateName);
  const existingPublicB64 = await idbGet(publicName);
  if (existingPrivateJwk && existingPublicB64) {
    return {
      privateJwk: existingPrivateJwk,
      publicSpkiB64: existingPublicB64
    };
  }
  if (existingPrivateJwk && !existingPublicB64) {
    const { n, e } = existingPrivateJwk;
    if (!n || !e) {
      throw new Error("Stored private key is invalid");
    }
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "RSA",
        n,
        e,
        alg: "RSA-OAEP-256",
        ext: true,
        key_ops: ["encrypt", "wrapKey"]
      },
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["encrypt", "wrapKey"]
    );
    const publicSpki = await crypto.subtle.exportKey("spki", publicKey);
    const publicSpkiB64 = bufferToBase64(publicSpki);
    await idbSet(publicName, publicSpkiB64);
    return {
      privateJwk: existingPrivateJwk,
      publicSpkiB64
    };
  }

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );

  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicSpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicSpkiB64 = bufferToBase64(publicSpki);

  await idbSet(privateName, privateJwk);
  await idbSet(publicName, publicSpkiB64);

  return { privateJwk, publicSpkiB64 };
}

export async function ensureUserKeyPair(userId, backendPublicSpkiB64, uploadPublicKey) {
  const identity = await getOrCreateIdentity(userId);
  if (!backendPublicSpkiB64 || backendPublicSpkiB64 !== identity.publicSpkiB64) {
    await uploadPublicKey(identity.publicSpkiB64);
  }
  return identity.publicSpkiB64;
}

export async function getPrivateKey(userId) {
  const { privateName } = keyNames(userId);
  const privateJwk = await idbGet(privateName);
  if (!privateJwk) throw new Error("Private key missing in IndexedDB");
  return importPrivateKeyFromJwk(privateJwk);
}

function buildAad({ senderId, receiverId, chatId, clientTs, clientMsgId }) {
  return JSON.stringify({
    senderId: String(senderId),
    receiverId: String(receiverId),
    chatId: String(chatId),
    clientTs: Number(clientTs),
    clientMsgId: String(clientMsgId)
  });
}

async function computeIntegrityHash(parts) {
  const raw = [
    parts.ciphertextB64 || "",
    parts.ivB64 || "",
    parts.wrappedKeyB64 || "",
    parts.senderWrappedKeyB64 || "",
    parts.aadB64 || "",
    String(parts.clientTs || 0),
    parts.clientMsgId || "",
    String(parts.senderId || ""),
    String(parts.receiverId || "")
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  return bufferToBase64(digest);
}

export async function encryptForReceiver({
  senderId,
  receiverId,
  chatId,
  senderPublicSpkiB64,
  receiverPublicSpkiB64,
  plainText = "",
  binaryData = null
}) {
  if (!receiverPublicSpkiB64) {
    throw new Error("Receiver public key missing");
  }

  const receiverPublicKey = await importPublicKeyFromSpkiB64(receiverPublicSpkiB64);
  const senderPublicKey = senderPublicSpkiB64
    ? await importPublicKeyFromSpkiB64(senderPublicSpkiB64)
    : null;
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clientTs = Date.now();
  const clientMsgId = crypto.randomUUID();
  const aadText = buildAad({ senderId, receiverId, chatId, clientTs, clientMsgId });
  const aadBytes = encoder.encode(aadText);
  const payloadBytes = binaryData || encoder.encode(plainText);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aadBytes },
    aesKey,
    payloadBytes
  );

  const wrappedKey = await crypto.subtle.wrapKey(
    "raw",
    aesKey,
    receiverPublicKey,
    { name: "RSA-OAEP" }
  );
  const senderWrappedKey = senderPublicKey
    ? await crypto.subtle.wrapKey(
      "raw",
      aesKey,
      senderPublicKey,
      { name: "RSA-OAEP" }
    )
    : null;

  const ciphertextB64 = bufferToBase64(cipherBuffer);
  const ivB64 = bufferToBase64(iv.buffer);
  const wrappedKeyB64 = bufferToBase64(wrappedKey);
  const senderWrappedKeyB64 = senderWrappedKey ? bufferToBase64(senderWrappedKey) : "";
  const aadB64 = bufferToBase64(aadBytes.buffer);
  const integrityHash = await computeIntegrityHash({
    ciphertextB64,
    ivB64,
    wrappedKeyB64,
    senderWrappedKeyB64,
    aadB64,
    clientTs,
    clientMsgId,
    senderId,
    receiverId
  });

  return {
    ciphertextB64,
    ivB64,
    wrappedKeyB64,
    senderWrappedKeyB64,
    aadB64,
    clientTs,
    clientMsgId,
    integrityHash
  };
}

function resolveWrappedKeyForCurrentUser(userId, message) {
  const me = String(userId || "");
  const senderId = String(message?.senderId || "");
  const receiverId = String(message?.receiverId || "");

  if (senderId === me && message?.senderWrappedKeyB64) {
    return message.senderWrappedKeyB64;
  }
  if (receiverId === me && message?.wrappedKeyB64) {
    return message.wrappedKeyB64;
  }
  if (message?.wrappedKeyB64) {
    return message.wrappedKeyB64;
  }
  if (message?.senderWrappedKeyB64) {
    return message.senderWrappedKeyB64;
  }
  throw new Error("No encrypted key envelope found for current user");
}

export async function decryptForCurrentUser({ userId, message, cipherBufferOverride = null }) {
  if ((!message?.wrappedKeyB64 && !message?.senderWrappedKeyB64) || !message?.iv || !message?.aadB64) {
    throw new Error("Encrypted message metadata missing");
  }

  if (message?.integrityHash) {
    const expectedHash = await computeIntegrityHash({
      ciphertextB64: message.ciphertextB64 || message.content || "",
      ivB64: message.iv || "",
      wrappedKeyB64: message.wrappedKeyB64 || "",
      senderWrappedKeyB64: message.senderWrappedKeyB64 || "",
      aadB64: message.aadB64 || "",
      clientTs: message.clientTs,
      clientMsgId: message.clientMsgId || "",
      senderId: message.senderId,
      receiverId: message.receiverId
    });
    if (expectedHash !== message.integrityHash) {
      throw new Error("Integrity check failed");
    }
  }

  const privateKey = await getPrivateKey(userId);
  const wrappedKeyForMe = resolveWrappedKeyForCurrentUser(userId, message);
  const aesKey = await crypto.subtle.unwrapKey(
    "raw",
    base64ToBuffer(wrappedKeyForMe),
    privateKey,
    { name: "RSA-OAEP" },
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const cipherBuffer =
    cipherBufferOverride ||
    base64ToBuffer(message.ciphertextB64 || message.content || "");

  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(base64ToBuffer(message.iv)),
      additionalData: new Uint8Array(base64ToBuffer(message.aadB64))
    },
    aesKey,
    cipherBuffer
  );

  return plainBuffer;
}

export async function decryptTextForCurrentUser({ userId, message }) {
  const plainBuffer = await decryptForCurrentUser({ userId, message });
  return decoder.decode(plainBuffer);
}

export async function decryptBinaryForCurrentUser({ userId, message, cipherBuffer }) {
  return decryptForCurrentUser({ userId, message, cipherBufferOverride: cipherBuffer });
}

