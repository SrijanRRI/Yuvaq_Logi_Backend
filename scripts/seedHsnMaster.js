import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import HsnMaster from "../models/hsnMasterSchema.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const jsonPath = path.resolve(__dirname, "../data/hsn_master_from_pdf.json");

  const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const ops = rows.map((row) => ({
    updateOne: {
      filter: { codeDigits: row.codeDigits },
      update: {
        $set: {
          codeDisplay: row.codeDisplay,
          codeDigits: row.codeDigits,
          description: row.description,
          page: row.page || null,
          source: "HSN PDF",
        },
      },
      upsert: true,
    },
  }));

  await HsnMaster.bulkWrite(ops);
  console.log(`Seeded ${rows.length} HSN rows`);
  await mongoose.disconnect();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});