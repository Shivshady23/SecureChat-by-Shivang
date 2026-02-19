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
  console.log("Connected to MongoDB");
  const db = mongoose.connection.db;
  const res = await db.collection('users').deleteMany({ username: 'Shivang_2310' });
  console.log('Deleted count:', res.deletedCount);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });

