import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  CreateAssignmentBody,
  CreateBaseBody,
  CreateEquipmentTypeBody,
  CreateExpenditureBody,
  CreatePurchaseBody,
  CreateTransferBody,
  CreateUserBody,
  DeleteBaseParams,
  DeleteEquipmentTypeParams,
  DeleteUserParams,
  GetCurrentUserResponse,
  GetDashboardQueryParams,
  GetDashboardResponse,
  GetInventoryQueryParams,
  GetPurchaseParams,
  GetTransferParams,
  ListAssignmentsQueryParams,
  ListAuditLogsQueryParams,
  ListExpendituresQueryParams,
  ListPurchasesQueryParams,
  ListTransfersQueryParams,
  LoginBody,
  LoginResponse,
  UpdateBaseBody,
  UpdateBaseParams,
  UpdateEquipmentTypeBody,
  UpdateEquipmentTypeParams,
  UpdateTransferStatusBody,
  UpdateTransferStatusParams,
  UpdateUserBody,
  UpdateUserParams,
  UserInput,
} from "@workspace/api-zod";
import {
  authenticateToken,
  assertBaseAccess,
  authorizeRoles,
  scopedBaseId,
} from "../middlewares/auth";
import {
  comparePassword,
  createToken,
  hashPassword,
  type AuthUser,
} from "../lib/security";

const router: IRouter = Router();

const numberOrUndefined = (value: unknown): number | undefined => {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatDate = (value: Date | string): string => {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
};

const routeId = (req: Request): number => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return Number(raw);
};

const userFromRow = (row: AuthUser): AuthUser => ({
  id: row.id,
  username: row.username,
  role: row.role,
  baseId: row.baseId ?? null,
  baseName: row.baseName ?? null,
  lastActiveAt: row.lastActiveAt ?? null,
});

const badRequest = (res: Response, message: string): void => {
  res.status(400).json({ message });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected server error";

async function addAudit(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  userId: number,
  action: string,
  entityType: string,
  entityId: number | null,
  details: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, entityType, entityId, details],
  );
}

async function inventoryAvailable(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ available: number | string }> }> },
  baseId: number,
  equipmentTypeId: number,
): Promise<number> {
  const result = await client.query(
    `SELECT (
       COALESCE((SELECT SUM(quantity) FROM purchases WHERE base_id = $1 AND equipment_type_id = $2), 0)
       + COALESCE((SELECT SUM(quantity) FROM transfers WHERE destination_base_id = $1 AND equipment_type_id = $2 AND status = 'COMPLETED'), 0)
       - COALESCE((SELECT SUM(quantity) FROM transfers WHERE source_base_id = $1 AND equipment_type_id = $2 AND status = 'COMPLETED'), 0)
       - COALESCE((SELECT SUM(quantity) FROM assignments WHERE base_id = $1 AND equipment_type_id = $2), 0)
       - COALESCE((SELECT SUM(quantity) FROM expenditures WHERE base_id = $1 AND equipment_type_id = $2), 0)
     )::int AS available`,
    [baseId, equipmentTypeId],
  );
  return Number(result.rows[0]?.available ?? 0);
}

async function baseRow(baseId: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT id, name, location FROM bases WHERE id = $1`,
    [baseId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function equipmentRow(
  equipmentTypeId: number,
): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT id, name, category, unit FROM equipment_types WHERE id = $1`,
    [equipmentTypeId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function purchaseRow(id: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT p.id, p.base_id AS "baseId", b.name AS "baseName",
            p.equipment_type_id AS "equipmentTypeId", e.name AS "equipmentName",
            e.category, p.quantity, p.purchase_date AS "purchaseDate",
            u.username AS "createdBy", p.created_at AS "createdAt"
     FROM purchases p
     JOIN bases b ON b.id = p.base_id
     JOIN equipment_types e ON e.id = p.equipment_type_id
     JOIN users u ON u.id = p.created_by
     WHERE p.id = $1`,
    [id],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function transferRow(id: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT t.id, t.source_base_id AS "sourceBaseId", sb.name AS "sourceBaseName",
            t.destination_base_id AS "destinationBaseId", db.name AS "destinationBaseName",
            t.equipment_type_id AS "equipmentTypeId", e.name AS "equipmentName",
            e.category, t.quantity, t.status, u.username AS "initiatedBy",
            t.timestamp
     FROM transfers t
     JOIN bases sb ON sb.id = t.source_base_id
     JOIN bases db ON db.id = t.destination_base_id
     JOIN equipment_types e ON e.id = t.equipment_type_id
     JOIN users u ON u.id = t.initiated_by
     WHERE t.id = $1`,
    [id],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function dashboardMetrics(
  user: AuthUser,
  params: {
    baseId?: number;
    equipmentTypeId?: number;
    startDate?: string;
    endDate?: string;
  },
): Promise<Record<string, unknown>> {
  const baseId = scopedBaseId({ user } as Request, params.baseId);
  const equipmentTypeId = params.equipmentTypeId ?? null;

  const endDate =
    params.endDate ?? new Date().toISOString().slice(0, 10);

  const startDate =
    params.startDate ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  const result = await pool.query(
    `WITH period AS (
      SELECT
        COALESCE((SELECT SUM(quantity) FROM purchases
          WHERE ($1::int IS NULL OR base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND purchase_date < $3::date), 0) AS purchase_opening,
        COALESCE((SELECT SUM(quantity) FROM transfers
          WHERE ($1::int IS NULL OR destination_base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND status = 'COMPLETED' AND timestamp < $3::date), 0) AS transfer_in_opening,
        COALESCE((SELECT SUM(quantity) FROM transfers
          WHERE ($1::int IS NULL OR source_base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND status = 'COMPLETED' AND timestamp < $3::date), 0) AS transfer_out_opening,
        COALESCE((SELECT SUM(quantity) FROM assignments
          WHERE ($1::int IS NULL OR base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND assigned_at < $3::date), 0) AS assigned_opening,
        COALESCE((SELECT SUM(quantity) FROM expenditures
          WHERE ($1::int IS NULL OR base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND expended_at < $3::date), 0) AS expended_opening,
        COALESCE((SELECT SUM(quantity) FROM purchases
          WHERE ($1::int IS NULL OR base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND purchase_date >= $3::date AND purchase_date <= $4::date), 0) AS purchases,
        COALESCE((SELECT SUM(quantity) FROM transfers
          WHERE ($1::int IS NULL OR destination_base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND status = 'COMPLETED' AND timestamp >= $3::date AND timestamp <= $4::date + 1), 0) AS transfers_in,
        COALESCE((SELECT SUM(quantity) FROM transfers
          WHERE ($1::int IS NULL OR source_base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND status = 'COMPLETED' AND timestamp >= $3::date AND timestamp <= $4::date + 1), 0) AS transfers_out,
        COALESCE((SELECT SUM(quantity) FROM assignments
          WHERE ($1::int IS NULL OR base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND assigned_at >= $3::date AND assigned_at <= $4::date + 1), 0) AS assigned,
        COALESCE((SELECT SUM(quantity) FROM expenditures
          WHERE ($1::int IS NULL OR base_id = $1) AND ($2::int IS NULL OR equipment_type_id = $2)
            AND expended_at >= $3::date AND expended_at <= $4::date + 1), 0) AS expended
    )
    SELECT
      (purchase_opening + transfer_in_opening - transfer_out_opening - assigned_opening - expended_opening)::int AS "openingBalance",
      purchases::int, transfers_in::int AS "transfersIn", transfers_out::int AS "transfersOut",
      (purchases + transfers_in - transfers_out)::int AS "netMovement",
      assigned::int, expended::int,
      (purchase_opening + transfer_in_opening - transfer_out_opening - assigned_opening - expended_opening
        + purchases + transfers_in - transfers_out - assigned - expended)::int AS "closingBalance"
    FROM period`,
    [baseId ?? null, equipmentTypeId, startDate, endDate],
  );
  const row = result.rows[0] as Record<string, unknown>;

  const categoryResult = await pool.query(
    `SELECT e.category AS label,
       (COALESCE(SUM(p.quantity) FILTER (WHERE p.id IS NOT NULL), 0)
        + COALESCE(SUM(t.quantity) FILTER (WHERE t.destination_base_id IS NOT NULL AND t.status = 'COMPLETED'), 0)
        - COALESCE(SUM(t.quantity) FILTER (WHERE t.source_base_id IS NOT NULL AND t.status = 'COMPLETED'), 0)
        - COALESCE(SUM(a.quantity), 0) - COALESCE(SUM(x.quantity), 0))::int AS value
     FROM equipment_types e
     LEFT JOIN purchases p ON p.equipment_type_id = e.id AND ($1::int IS NULL OR p.base_id = $1)
     LEFT JOIN transfers t ON t.equipment_type_id = e.id
       AND ($1::int IS NULL OR t.destination_base_id = $1 OR t.source_base_id = $1)
     LEFT JOIN assignments a ON a.equipment_type_id = e.id AND ($1::int IS NULL OR a.base_id = $1)
     LEFT JOIN expenditures x ON x.equipment_type_id = e.id AND ($1::int IS NULL OR x.base_id = $1)
     WHERE ($2::int IS NULL OR e.id = $2)
     GROUP BY e.category ORDER BY e.category`,
    [baseId ?? null, equipmentTypeId],
  );
  const movementResult = await pool.query(
    `SELECT to_char(day, 'Mon DD') AS label,
       COALESCE((SELECT SUM(quantity) FROM purchases WHERE purchase_date = day AND ($1::int IS NULL OR base_id = $1)), 0)::int AS value,
       COALESCE((SELECT SUM(quantity) FROM expenditures WHERE expended_at::date = day AND ($1::int IS NULL OR base_id = $1)), 0)::int AS "secondaryValue"
     FROM generate_series($2::date, $3::date, interval '1 day') day
     ORDER BY day`,
    [baseId ?? null, startDate, endDate],
  );
  const activityResult = await pool.query(
    `SELECT a.id, a.user_id AS "userId", u.username, a.action, a.entity_type AS "entityType",
            a.entity_id AS "entityId", a.details, a.created_at AS "createdAt"
     FROM audit_logs a JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT 8`,
  );
  return {
    ...row,
    inventoryByCategory: categoryResult.rows,
    movementSeries: movementResult.rows,
    recentActivity: activityResult.rows,
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Username and password are required");
    return;
  }
  const result = await pool.query(
    `SELECT u.id, u.username, u.password_hash AS "passwordHash", u.role,
            u.base_id AS "baseId", b.name AS "baseName", u.last_active_at AS "lastActiveAt"
     FROM users u LEFT JOIN bases b ON b.id = u.base_id WHERE u.username = $1`,
    [parsed.data.username],
  );
  const row = result.rows[0] as (AuthUser & { passwordHash: string }) | undefined;
  if (!row || !(await comparePassword(parsed.data.password, row.passwordHash))) {
    res.status(401).json({ message: "Invalid username or password" });
    return;
  }
  await pool.query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [row.id]);
  const user = userFromRow(row);
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES ($1, 'LOGIN', 'AUTH', $2)`,
    [user.id, `${user.username} signed in`],
  );
  res.json(LoginResponse.parse({ token: createToken(user), user }));
});

router.get("/auth/me", authenticateToken, async (req, res): Promise<void> => {
  res.json(GetCurrentUserResponse.parse(req.user));
});

router.get("/dashboard", authenticateToken, async (req, res): Promise<void> => {
  const parsed = GetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success || !req.user) {
    badRequest(res, "Invalid dashboard filters");
    return;
  }
  const data = await dashboardMetrics(req.user, {
    baseId: parsed.data.baseId,
    equipmentTypeId: parsed.data.equipmentTypeId,
    startDate: parsed.data.startDate ? formatDate(parsed.data.startDate) : undefined,
    endDate: parsed.data.endDate ? formatDate(parsed.data.endDate) : undefined,
  });
  res.json(GetDashboardResponse.parse(data));
});

router.get("/inventory", authenticateToken, async (req, res): Promise<void> => {
  const parsed = GetInventoryQueryParams.safeParse(req.query);
  if (!parsed.success || !req.user) {
    badRequest(res, "Invalid inventory filters");
    return;
  }
  const scoped = scopedBaseId(req, parsed.data.baseId);
  const result = await pool.query(
    `SELECT b.id AS "baseId", b.name AS "baseName", e.id AS "equipmentTypeId",
       e.name AS "equipmentName", e.category,
       (COALESCE((SELECT SUM(quantity) FROM purchases p WHERE p.base_id = b.id AND p.equipment_type_id = e.id), 0)
        + COALESCE((SELECT SUM(quantity) FROM transfers t WHERE t.destination_base_id = b.id AND t.equipment_type_id = e.id AND t.status = 'COMPLETED'), 0)
        - COALESCE((SELECT SUM(quantity) FROM transfers t WHERE t.source_base_id = b.id AND t.equipment_type_id = e.id AND t.status = 'COMPLETED'), 0)
        - COALESCE((SELECT SUM(quantity) FROM assignments a WHERE a.base_id = b.id AND a.equipment_type_id = e.id), 0)
        - COALESCE((SELECT SUM(quantity) FROM expenditures x WHERE x.base_id = b.id AND x.equipment_type_id = e.id), 0))::int AS available,
       COALESCE((SELECT SUM(quantity) FROM assignments a WHERE a.base_id = b.id AND a.equipment_type_id = e.id), 0)::int AS assigned,
       COALESCE((SELECT SUM(quantity) FROM expenditures x WHERE x.base_id = b.id AND x.equipment_type_id = e.id), 0)::int AS expended
     FROM bases b CROSS JOIN equipment_types e
     WHERE ($1::int IS NULL OR b.id = $1) AND ($2::int IS NULL OR e.id = $2)
     ORDER BY b.name, e.category, e.name`,
    [scoped ?? null, parsed.data.equipmentTypeId ?? null],
  );
  res.json(result.rows);
});

router.get("/bases", authenticateToken, async (req, res): Promise<void> => {
  const scoped = scopedBaseId(req);
  const result = await pool.query(
    `SELECT b.id, b.name, b.location,
       (COALESCE((SELECT SUM(quantity) FROM purchases p WHERE p.base_id = b.id), 0)
        - COALESCE((SELECT SUM(quantity) FROM assignments a WHERE a.base_id = b.id), 0)
        - COALESCE((SELECT SUM(quantity) FROM expenditures x WHERE x.base_id = b.id), 0)
        + COALESCE((SELECT SUM(quantity) FROM transfers t WHERE t.destination_base_id = b.id AND t.status = 'COMPLETED'), 0)
        - COALESCE((SELECT SUM(quantity) FROM transfers t WHERE t.source_base_id = b.id AND t.status = 'COMPLETED'), 0))::int AS "assetCount",
       100::int AS readiness
     FROM bases b WHERE ($1::int IS NULL OR b.id = $1) ORDER BY b.name`,
    [scoped ?? null],
  );
  res.json(result.rows);
});

router.post("/bases", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const parsed = CreateBaseBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Name and location are required");
    return;
  }
  const result = await pool.query(
    `INSERT INTO bases (name, location) VALUES ($1, $2) RETURNING id, name, location`,
    [parsed.data.name, parsed.data.location],
  );
  res.status(201).json(result.rows[0]);
});

router.put("/bases/:id", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const params = UpdateBaseParams.safeParse({ id: routeId(req) });
  const parsed = UpdateBaseBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    badRequest(res, "Invalid base");
    return;
  }
  const result = await pool.query(
    `UPDATE bases SET name = $1, location = $2 WHERE id = $3 RETURNING id, name, location`,
    [parsed.data.name, parsed.data.location, params.data.id],
  );
  if (!result.rowCount) {
    res.status(404).json({ message: "Base not found" });
    return;
  }
  res.json(result.rows[0]);
});

router.delete("/bases/:id", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const params = DeleteBaseParams.safeParse({ id: routeId(req) });
  if (!params.success) {
    badRequest(res, "Invalid base");
    return;
  }
  const result = await pool.query("DELETE FROM bases WHERE id = $1", [params.data.id]);
  if (!result.rowCount) {
    res.status(404).json({ message: "Base not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/equipment-types", authenticateToken, async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT id, name, category, unit FROM equipment_types ORDER BY category, name`,
  );
  res.json(result.rows);
});

router.post("/equipment-types", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const parsed = CreateEquipmentTypeBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, "Invalid equipment type");
    return;
  }
  const result = await pool.query(
    `INSERT INTO equipment_types (name, category, unit) VALUES ($1, $2, $3) RETURNING id, name, category, unit`,
    [parsed.data.name, parsed.data.category, parsed.data.unit ?? "units"],
  );
  res.status(201).json(result.rows[0]);
});

router.put("/equipment-types/:id", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const params = UpdateEquipmentTypeParams.safeParse({ id: routeId(req) });
  const parsed = UpdateEquipmentTypeBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    badRequest(res, "Invalid equipment type");
    return;
  }
  const result = await pool.query(
    `UPDATE equipment_types SET name = $1, category = $2, unit = $3 WHERE id = $4 RETURNING id, name, category, unit`,
    [parsed.data.name, parsed.data.category, parsed.data.unit ?? "units", params.data.id],
  );
  if (!result.rowCount) {
    res.status(404).json({ message: "Equipment type not found" });
    return;
  }
  res.json(result.rows[0]);
});

router.delete("/equipment-types/:id", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const params = DeleteEquipmentTypeParams.safeParse({ id: routeId(req) });
  if (!params.success) {
    badRequest(res, "Invalid equipment type");
    return;
  }
  const result = await pool.query("DELETE FROM equipment_types WHERE id = $1", [params.data.id]);
  if (!result.rowCount) {
    res.status(404).json({ message: "Equipment type not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/purchases", authenticateToken, async (req, res): Promise<void> => {
  const parsed = ListPurchasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "Invalid purchase filters");
    return;
  }
  const scoped = scopedBaseId(req, parsed.data.baseId);
  const result = await pool.query(
    `SELECT p.id, p.base_id AS "baseId", b.name AS "baseName",
            p.equipment_type_id AS "equipmentTypeId", e.name AS "equipmentName",
            e.category, p.quantity, p.purchase_date AS "purchaseDate",
            u.username AS "createdBy", p.created_at AS "createdAt"
     FROM purchases p JOIN bases b ON b.id = p.base_id
     JOIN equipment_types e ON e.id = p.equipment_type_id JOIN users u ON u.id = p.created_by
     WHERE ($1::int IS NULL OR p.base_id = $1) AND ($2::int IS NULL OR p.equipment_type_id = $2)
     ORDER BY p.purchase_date DESC, p.created_at DESC`,
    [scoped ?? null, parsed.data.equipmentTypeId ?? null],
  );
  res.json(result.rows);
});

router.post("/purchases", authenticateToken, authorizeRoles("ADMIN", "BASE_COMMANDER", "LOGISTICS_OFFICER"), async (req, res): Promise<void> => {
  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success || !parsed.data || !req.user || !assertBaseAccess(req, res, parsed.data.baseId)) {
    badRequest(res, "Invalid purchase or base scope");
    return;
  }
  const result = await pool.query(
    `INSERT INTO purchases (base_id, equipment_type_id, quantity, purchase_date, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [parsed.data.baseId, parsed.data.equipmentTypeId, parsed.data.quantity, formatDate(parsed.data.purchaseDate), req.user.id],
  );
  await addAudit(pool, req.user.id, "PURCHASE", "PURCHASE", result.rows[0].id, `Received ${parsed.data.quantity} items into base ${parsed.data.baseId}`);
  const row = await purchaseRow(result.rows[0].id);
  res.status(201).json(row);
});

router.get("/purchases/:id", authenticateToken, async (req, res): Promise<void> => {
  const params = GetPurchaseParams.safeParse({ id: routeId(req) });
  const row = params.success ? await purchaseRow(params.data.id) : undefined;
  if (!row || !assertBaseAccess(req, res, Number(row.baseId))) {
    if (row) return;
    res.status(404).json({ message: "Purchase not found" });
    return;
  }
  res.json(row);
});

router.get("/transfers", authenticateToken, async (req, res): Promise<void> => {
  const parsed = ListTransfersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "Invalid transfer filters");
    return;
  }
  const scoped = scopedBaseId(req, parsed.data.baseId);
  const result = await pool.query(
    `SELECT t.id, t.source_base_id AS "sourceBaseId", sb.name AS "sourceBaseName",
            t.destination_base_id AS "destinationBaseId", db.name AS "destinationBaseName",
            t.equipment_type_id AS "equipmentTypeId", e.name AS "equipmentName",
            e.category, t.quantity, t.status, u.username AS "initiatedBy", t.timestamp
     FROM transfers t JOIN bases sb ON sb.id = t.source_base_id JOIN bases db ON db.id = t.destination_base_id
     JOIN equipment_types e ON e.id = t.equipment_type_id JOIN users u ON u.id = t.initiated_by
     WHERE ($1::int IS NULL OR t.source_base_id = $1 OR t.destination_base_id = $1)
       AND ($2::text IS NULL OR t.status = $2)
     ORDER BY t.timestamp DESC`,
    [scoped ?? null, parsed.data.status ?? null],
  );
  res.json(result.rows);
});

router.post("/transfers", authenticateToken, authorizeRoles("ADMIN", "BASE_COMMANDER", "LOGISTICS_OFFICER"), async (req, res): Promise<void> => {
  const parsed = CreateTransferBody.safeParse(req.body);
  if (!parsed.success || !parsed.data || !req.user) {
    badRequest(res, "Invalid transfer");
    return;
  }
  const { sourceBaseId, destinationBaseId, equipmentTypeId, quantity } = parsed.data;
  if (sourceBaseId === destinationBaseId || !assertBaseAccess(req, res, sourceBaseId) || !assertBaseAccess(req, res, destinationBaseId)) {
    badRequest(res, "Source and destination bases must be different and in scope");
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const available = await inventoryAvailable(client, sourceBaseId, equipmentTypeId);
    if (available < quantity) {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "Insufficient inventory", available, requested: quantity });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO transfers (source_base_id, destination_base_id, equipment_type_id, quantity, status, initiated_by)
       VALUES ($1, $2, $3, $4, 'COMPLETED', $5) RETURNING id`,
      [sourceBaseId, destinationBaseId, equipmentTypeId, quantity, req.user.id],
    );
    await addAudit(client, req.user.id, "TRANSFER", "TRANSFER", inserted.rows[0].id, `Transferred ${quantity} items from base ${sourceBaseId} to base ${destinationBaseId}`);
    await client.query("COMMIT");
    res.status(201).json(await transferRow(inserted.rows[0].id));
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: "Transfer failed" });
  } finally {
    client.release();
  }
});

router.get("/transfers/:id", authenticateToken, async (req, res): Promise<void> => {
  const params = GetTransferParams.safeParse({ id: routeId(req) });
  const row = params.success ? await transferRow(params.data.id) : undefined;
  if (!row) {
    res.status(404).json({ message: "Transfer not found" });
    return;
  }
  if (!assertBaseAccess(req, res, Number(row.sourceBaseId)) || !assertBaseAccess(req, res, Number(row.destinationBaseId))) return;
  res.json(row);
});

router.put("/transfers/:id/status", authenticateToken, authorizeRoles("ADMIN", "BASE_COMMANDER", "LOGISTICS_OFFICER"), async (req, res): Promise<void> => {
  const params = UpdateTransferStatusParams.safeParse({ id: routeId(req) });
  const parsed = UpdateTransferStatusBody.safeParse(req.body);
  if (!params.success || !parsed.success || !req.user) {
    badRequest(res, "Invalid transfer status");
    return;
  }
  const row = await transferRow(params.data.id);
  if (!row || !assertBaseAccess(req, res, Number(row.sourceBaseId))) {
    res.status(404).json({ message: "Transfer not found" });
    return;
  }
  const result = await pool.query(
    `UPDATE transfers SET status = $1 WHERE id = $2 RETURNING id`,
    [parsed.data.status, params.data.id],
  );
  await addAudit(pool, req.user.id, "TRANSFER", "TRANSFER", params.data.id, `Transfer status changed to ${parsed.data.status}`);
  res.json(await transferRow(result.rows[0].id));
});

router.get("/assignments", authenticateToken, async (req, res): Promise<void> => {
  const parsed = ListAssignmentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "Invalid assignment filters");
    return;
  }
  const scoped = scopedBaseId(req, parsed.data.baseId);
  const result = await pool.query(
    `SELECT a.id, a.base_id AS "baseId", b.name AS "baseName",
       a.equipment_type_id AS "equipmentTypeId", e.name AS "equipmentName", e.category,
       a.personnel_name AS "personnelName", a.quantity, u.username AS "assignedBy", a.assigned_at AS "assignedAt"
     FROM assignments a JOIN bases b ON b.id = a.base_id JOIN equipment_types e ON e.id = a.equipment_type_id
     JOIN users u ON u.id = a.assigned_by
     WHERE ($1::int IS NULL OR a.base_id = $1) ORDER BY a.assigned_at DESC`,
    [scoped ?? null],
  );
  res.json(result.rows);
});

router.post("/assignments", authenticateToken, authorizeRoles("ADMIN", "BASE_COMMANDER"), async (req, res): Promise<void> => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success || !parsed.data || !req.user || !assertBaseAccess(req, res, parsed.data.baseId)) {
    badRequest(res, "Invalid assignment or base scope");
    return;
  }
  const available = await inventoryAvailable(pool, parsed.data.baseId, parsed.data.equipmentTypeId);
  if (available < parsed.data.quantity) {
    res.status(400).json({ message: "Insufficient inventory", available, requested: parsed.data.quantity });
    return;
  }
  const result = await pool.query(
    `INSERT INTO assignments (base_id, equipment_type_id, personnel_name, quantity, assigned_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [parsed.data.baseId, parsed.data.equipmentTypeId, parsed.data.personnelName, parsed.data.quantity, req.user.id],
  );
  await addAudit(pool, req.user.id, "ASSIGNMENT", "ASSIGNMENT", result.rows[0].id, `Assigned ${parsed.data.quantity} items to ${parsed.data.personnelName}`);
  const item = await pool.query(
    `SELECT a.id, a.base_id AS "baseId", b.name AS "baseName", a.equipment_type_id AS "equipmentTypeId",
       e.name AS "equipmentName", e.category, a.personnel_name AS "personnelName", a.quantity,
       u.username AS "assignedBy", a.assigned_at AS "assignedAt"
     FROM assignments a JOIN bases b ON b.id = a.base_id JOIN equipment_types e ON e.id = a.equipment_type_id
     JOIN users u ON u.id = a.assigned_by WHERE a.id = $1`,
    [result.rows[0].id],
  );
  res.status(201).json(item.rows[0]);
});

router.get("/expenditures", authenticateToken, async (req, res): Promise<void> => {
  const parsed = ListExpendituresQueryParams.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "Invalid expenditure filters");
    return;
  }
  const scoped = scopedBaseId(req, parsed.data.baseId);
  const result = await pool.query(
    `SELECT x.id, x.base_id AS "baseId", b.name AS "baseName", x.equipment_type_id AS "equipmentTypeId",
       e.name AS "equipmentName", e.category, x.quantity, x.reason, u.username AS "recordedBy", x.expended_at AS "expendedAt"
     FROM expenditures x JOIN bases b ON b.id = x.base_id JOIN equipment_types e ON e.id = x.equipment_type_id
     JOIN users u ON u.id = x.recorded_by
     WHERE ($1::int IS NULL OR x.base_id = $1) ORDER BY x.expended_at DESC`,
    [scoped ?? null],
  );
  res.json(result.rows);
});

router.post("/expenditures", authenticateToken, authorizeRoles("ADMIN", "BASE_COMMANDER"), async (req, res): Promise<void> => {
  const parsed = CreateExpenditureBody.safeParse(req.body);
  if (!parsed.success || !parsed.data || !req.user || !assertBaseAccess(req, res, parsed.data.baseId)) {
    badRequest(res, "Invalid expenditure or base scope");
    return;
  }
  const available = await inventoryAvailable(pool, parsed.data.baseId, parsed.data.equipmentTypeId);
  if (available < parsed.data.quantity) {
    res.status(400).json({ message: "Insufficient inventory", available, requested: parsed.data.quantity });
    return;
  }
  const result = await pool.query(
    `INSERT INTO expenditures (base_id, equipment_type_id, quantity, reason, recorded_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [parsed.data.baseId, parsed.data.equipmentTypeId, parsed.data.quantity, parsed.data.reason, req.user.id],
  );
  await addAudit(pool, req.user.id, "EXPENDITURE", "EXPENDITURE", result.rows[0].id, `${parsed.data.quantity} items expended: ${parsed.data.reason}`);
  const item = await pool.query(
    `SELECT x.id, x.base_id AS "baseId", b.name AS "baseName", x.equipment_type_id AS "equipmentTypeId",
       e.name AS "equipmentName", e.category, x.quantity, x.reason, u.username AS "recordedBy", x.expended_at AS "expendedAt"
     FROM expenditures x JOIN bases b ON b.id = x.base_id JOIN equipment_types e ON e.id = x.equipment_type_id
     JOIN users u ON u.id = x.recorded_by WHERE x.id = $1`,
    [result.rows[0].id],
  );
  res.status(201).json(item.rows[0]);
});

router.get("/audit-logs", authenticateToken, async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    badRequest(res, "Invalid audit filters");
    return;
  }
  const scoped = scopedBaseId(req, parsed.data.baseId);
  const result = await pool.query(
    `SELECT DISTINCT a.id, a.user_id AS "userId", u.username, a.action, a.entity_type AS "entityType",
       a.entity_id AS "entityId", a.details, a.created_at AS "createdAt"
     FROM audit_logs a JOIN users u ON u.id = a.user_id
     LEFT JOIN purchases p ON a.entity_type = 'PURCHASE' AND p.id = a.entity_id
     LEFT JOIN transfers t ON a.entity_type = 'TRANSFER' AND t.id = a.entity_id
     LEFT JOIN assignments ass ON a.entity_type = 'ASSIGNMENT' AND ass.id = a.entity_id
     LEFT JOIN expenditures x ON a.entity_type = 'EXPENDITURE' AND x.id = a.entity_id
     WHERE ($1::int IS NULL OR COALESCE(p.base_id, t.source_base_id, ass.base_id, x.base_id) = $1)
     ORDER BY a.created_at DESC LIMIT 100`,
    [scoped ?? null],
  );
  res.json(result.rows);
});

router.get("/users", authenticateToken, authorizeRoles("ADMIN"), async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT u.id, u.username, u.role, u.base_id AS "baseId", b.name AS "baseName", u.last_active_at AS "lastActiveAt"
     FROM users u LEFT JOIN bases b ON b.id = u.base_id ORDER BY u.username`,
  );
  res.json(result.rows);
});

router.post("/users", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success || !parsed.data) {
    badRequest(res, "Invalid user");
    return;
  }
  const result = await pool.query(
    `INSERT INTO users (username, password_hash, role, base_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [parsed.data.username, await hashPassword(parsed.data.password), parsed.data.role, parsed.data.baseId ?? null],
  );
  const userResult = await pool.query(
    `SELECT u.id, u.username, u.role, u.base_id AS "baseId", b.name AS "baseName", u.last_active_at AS "lastActiveAt"
     FROM users u LEFT JOIN bases b ON b.id = u.base_id WHERE u.id = $1`,
    [result.rows[0].id],
  );
  if (req.user) await addAudit(pool, req.user.id, "USER_CREATED", "USER", result.rows[0].id, `Created user ${parsed.data.username}`);
  res.status(201).json(userResult.rows[0]);
});

router.put("/users/:id", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse({ id: routeId(req) });
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!params.success || !parsed.success || !parsed.data) {
    badRequest(res, "Invalid user");
    return;
  }
  const updates: string[] = [];
  const values: unknown[] = [];
  if (parsed.data.username !== undefined) { values.push(parsed.data.username); updates.push(`username = $${values.length}`); }
  if (parsed.data.password !== undefined) { values.push(await hashPassword(parsed.data.password)); updates.push(`password_hash = $${values.length}`); }
  if (parsed.data.role !== undefined) { values.push(parsed.data.role); updates.push(`role = $${values.length}`); }
  if (parsed.data.baseId !== undefined) { values.push(parsed.data.baseId); updates.push(`base_id = $${values.length}`); }
  if (!updates.length) {
    badRequest(res, "No changes supplied");
    return;
  }
  values.push(params.data.id);
  const result = await pool.query(`UPDATE users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${values.length} RETURNING id`, values);
  if (!result.rowCount) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  const userResult = await pool.query(
    `SELECT u.id, u.username, u.role, u.base_id AS "baseId", b.name AS "baseName", u.last_active_at AS "lastActiveAt"
     FROM users u LEFT JOIN bases b ON b.id = u.base_id WHERE u.id = $1`,
    [params.data.id],
  );
  if (req.user) await addAudit(pool, req.user.id, "USER_UPDATED", "USER", params.data.id, `Updated user ${params.data.id}`);
  res.json(userResult.rows[0]);
});

router.delete("/users/:id", authenticateToken, authorizeRoles("ADMIN"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse({ id: routeId(req) });
  if (!params.success) {
    badRequest(res, "Invalid user");
    return;
  }
  const result = await pool.query("DELETE FROM users WHERE id = $1", [params.data.id]);
  if (!result.rowCount) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
