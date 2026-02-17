import Quotation from "../models/quotationSchema.js";

export async function getBestQuotesPerTransporter({ tenderId, phase = "normal" }) {
  const allQuotes = await Quotation.find({ tender: tenderId, phase }).sort({
    price: 1,
    createdAt: 1,
  });

  const bestMap = new Map(); // transportUserId -> best quotation
  for (const q of allQuotes) {
    const uid = String(q.transportUser);
    if (!bestMap.has(uid)) bestMap.set(uid, q);
  }

  // sorted best quotes by price + createdAt
  const bestSorted = Array.from(bestMap.values()).sort((a, b) => {
    if (a.price === b.price) return new Date(a.createdAt) - new Date(b.createdAt);
    return a.price - b.price;
  });

  return bestSorted;
}