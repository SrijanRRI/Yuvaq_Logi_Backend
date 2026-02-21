import "dotenv/config";
import app from "./app.js";
import connectToDb from "./config/dbConn.js";

const PORT = process.env.PORT || 6000;

(async () => {
  try {
    await connectToDb(); // WAIT FOR DB

    app.listen(PORT, "0.0.0.0", () => {
      console.log(` Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error(" Server startup failed:", err.message);
    process.exit(1); //  DO NOT run app without DB
  }
})();