// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/secure-chat";

async function run() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  try {
    const cols = await db.listCollections({ name: "users" }).toArray();
    if (cols.length === 0) {
      console.log("users collection not found — creating it");
      await db.createCollection("users");
    }

    const users = db.collection("users");
    const indexes = await users.indexes();
    console.log("Existing indexes:", indexes.map((i) => ({ name: i.name, key: i.key, unique: !!i.unique })));

    // Drop indexes that are not _id_ and not username_1
    for (const idx of indexes) {
      if (idx.name === "_id_") continue;
      if (idx.key && idx.key.username === 1) continue;
      try {
        await users.dropIndex(idx.name);
        console.log("Dropped index:", idx.name);
      } catch (err) {
        console.log("Could not drop index", idx.name, "-", err.message);
      }
    }

    // Ensure unique username index
    const after = await users.indexes();
    const usernameIdx = after.find((i) => i.key && i.key.username === 1);
    if (usernameIdx) {
      if (!usernameIdx.unique) {
        try {
          await users.dropIndex(usernameIdx.name);
          console.log("Dropped non-unique username index:", usernameIdx.name);
        } catch (err) {
          console.log("Failed to drop non-unique username index:", err.message);
        }
        try {
          await users.createIndex({ username: 1 }, { unique: true });
          console.log("Created unique index on username");
        } catch (err) {
          console.error("Failed creating unique username index:", err.message);
        }
      } else {
        console.log("Unique username index already present:", usernameIdx.name);
      }
    } else {
      try {
        await users.createIndex({ username: 1 }, { unique: true });
        console.log("Created unique index on username");
      } catch (err) {
        console.error("Failed creating unique username index:", err.message);
      }
    }
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Migration finished");
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

