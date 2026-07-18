import { Router } from "express";
import { authRouter } from "./auth.js";
import { userRouter } from "./user.js";
import { shopRouter } from "./shop.js";
import { cardsRouter } from "./cards.js";
import { leaderboardRouter } from "./leaderboard.js";
import { guildsRouter } from "./guilds.js";
import { lotteryRouter } from "./lottery.js";
import { communityRouter } from "./community.js";
import { adminRouter } from "./admin.js";
import { framesRouter } from "./frames.js";
import { auctionsRouter } from "./auctions.js";
import { territoriesRouter } from "./territories.js";

const router = Router();

router.use("/auth", authRouter);
router.use("/user", userRouter);
router.use("/shop", shopRouter);
router.use("/cards", cardsRouter);
router.use("/leaderboard", leaderboardRouter);
router.use("/guilds", guildsRouter);
router.use("/lottery", lotteryRouter);
router.use("/community", communityRouter);
router.use("/admin", adminRouter);
router.use("/frames", framesRouter);
router.use("/auctions", auctionsRouter);
router.use("/territories", territoriesRouter);

export { router as v1Router };
