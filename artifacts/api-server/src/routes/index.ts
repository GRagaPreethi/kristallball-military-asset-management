import { Router, type IRouter } from "express";
import healthRouter from "./health";
import kristallballRouter from "./kristallball";

const router: IRouter = Router();

router.use(healthRouter);
router.use(kristallballRouter);

export default router;
