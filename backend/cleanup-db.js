// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/secure-chat";

mongoose.connect(MONGO_URI).then(async () => {
  console.log("Connected to MongoDB");
  const db = mongoose.connection.db;
  
  // Drop all indexes on users collection
  try {
    await db.collection("users").dropIndexes();
    console.log("Dropped indexes on users collection");
  } catch (err) {
    console.log("Error dropping indexes:", err.message);
  }
  
  // Drop all collections to start fresh
  try {
    await db.dropCollection("users");
    console.log("Dropped users collection");
  } catch (err) {
    console.log("Users collection already absent");
  }
  
  try {
    await db.dropCollection("chats");
    console.log("Dropped chats collection");
  } catch (err) {
    console.log("Chats collection already absent");
  }
  
  try {
    await db.dropCollection("chatrequests");
    console.log("Dropped chatrequests collection");
  } catch (err) {
    console.log("ChatRequests collection already absent");
  }
  
  try {
    await db.dropCollection("messages");
    console.log("Dropped messages collection");
  } catch (err) {
    console.log("Messages collection already absent");
  }
  
  mongoose.disconnect();
  console.log("Database cleaned and ready for new schema");
}).catch(err => {
  console.error("Connection failed:", err);
  process.exit(1);
});

