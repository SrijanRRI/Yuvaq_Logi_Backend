import express from 'express'
import dotenv from 'dotenv';
dotenv.config();
import authRouter from './routes/userRouter.js';
import adminRouter from './routes/adminRouter.js';
import quotationRouter from './routes/quotationRouter.js';
import shipmentRouter from './routes/shipmentPlanningRouter.js';
import webhookRouter from "./routes/webhookRouter.js";
import "./cron/autoCloseTenders.js";
import tenderRouter from './routes/tenderRouter.js';
import connectToDb from './config/dbConn.js';
import cookieParser from 'cookie-parser'
import cors from 'cors';

const app = express();

connectToDb()

app.use(cors({ origin: [process.env.CLIENT_URL,"http://localhost:5173", "http://192.168.13.77:5173" , "http://192.168.13.86:85" , "https://logiq.yuvaq.com"] , credentials: true }));

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf; // ✅ store raw for webhook verification
  }
}));

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Third-party middleware
app.use('/api/auth',authRouter)
app.use('/admin', adminRouter);
app.use('/tenders',tenderRouter)
app.use('/quotation', quotationRouter);
app.use('/shipment-planning',shipmentRouter)
app.use("/webhooks", webhookRouter);

export default app;