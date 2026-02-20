// config/dbConn.js
import mongoose from "mongoose";

export default async function connectToDb() {
  const MONGODB_URL = process.env.MONGO_URI;

  if (!MONGODB_URL) {
    throw new Error("MONGO_URI missing in environment variables");
  }

  //  prevents infinite hanging when DB is down
  mongoose.set("bufferCommands", false);

  // optional recommended
  mongoose.set("strictQuery", true);

  try {
    const conn = await mongoose.connect(MONGODB_URL, {
      serverSelectionTimeoutMS: 10000, // fail fast
      connectTimeoutMS: 10000,
    });

    console.log(` Connected to DB: ${conn.connection.host}`);

    // Optional: log disconnects
    mongoose.connection.on("disconnected", () => {
      console.error("❌ MongoDB disconnected");
    });

    return conn;
  } catch (err) {
    console.error("❌ Mongo connection error:", err.message);
    throw err; // IMPORTANT: let server fail instead of running broken
  }
}