import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import { botRouter } from "./bot.js";
import { v1Router } from "./v1/index.js";
import { eventsRouter } from "./events.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/bot", botRouter);
router.use("/events", eventsRouter);
router.use("/v1", v1Router);

export default router;
