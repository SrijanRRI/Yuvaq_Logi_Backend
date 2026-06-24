import express from 'express'
import dotenv from 'dotenv';
dotenv.config();
import authRouter from './routes/userRouter.js';
import subscriptionRouter from "./routes/subscriptionRouter.js";
import adminRouter from './routes/adminRouter.js';
import quotationRouter from './routes/quotationRouter.js';
import shipmentRouter from './routes/shipmentPlanningRouter.js';
import webhookRouter from "./routes/webhookRouter.js";
import vehicleCatalogRouter from "./routes/vehicleCatalogRouter.js"
import "./cron/autoCloseTenders.js";
import tenderRouter from './routes/tenderRouter.js';
import hsnRouter from "./routes/hsnRouter.js";
import feedbackRouter from "./routes/feedbackRouter.js";
// import connectToDb from './config/dbConn.js';
import cookieParser from 'cookie-parser'
import cors from 'cors';
import autoEndPostBid from './cron/autoEndPostBid.js';
import startFinalizeDraftTenders from './cron/finalizeDraftTenders.js';
import autoStartPostBid from './cron/autoStartPostBid.js';

const app = express();

// connectToDb()

// Cron : 
console.log("[CRON] Starting auto post-bid cron...");
autoStartPostBid();
autoEndPostBid();
startFinalizeDraftTenders();

app.use(cors({ origin: [process.env.CLIENT_URL,"http://localhost:5173" , "http://192.168.13.86:85" , "http://192.168.13.86:89", "https://logiqtest.yuvaq.com" ,  "https://logiq.yuvaq.com" , "http://192.168.13.86:90" , "https://logiqofficial.yuvaq.com"] , credentials: true }));

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // ✅ store raw for webhook verification
  }
}));

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Third-party middleware

app.use('/api/auth',authRouter)
app.use("/subscriptions", subscriptionRouter);
app.use('/admin', adminRouter);
app.use('/tenders',tenderRouter)
app.use('/quotation', quotationRouter);
app.use('/shipment-planning',shipmentRouter)
app.use("/webhooks", webhookRouter);
app.use("/hsn", hsnRouter);
app.use("/vehicle", vehicleCatalogRouter);
app.use("/feedback", feedbackRouter);

// ✅ HEALTH CHECK (helps debug instantly)
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

export default app;