import { pool } from "@workspace/db";
import { hashPassword } from "./security";
import { logger } from "./logger";

export async function seedDemoData(): Promise<void> {
  const existing = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM users",
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  const bases = await pool.query<{ id: number; name: string }>(
    `INSERT INTO bases (name, location) VALUES
      ('Fort Alpha', 'Northern Command'),
      ('Fort Bravo', 'Eastern Corridor'),
      ('Fort Charlie', 'Coastal Sector')
     RETURNING id, name`,
  );
  const baseId = (name: string) => bases.rows.find((row) => row.name === name)!.id;

  const equipment = await pool.query<{ id: number; name: string }>(
    `INSERT INTO equipment_types (name, category, unit) VALUES
      ('M4 Carbine', 'WEAPON', 'weapons'),
      ('Humvee', 'VEHICLE', 'vehicles'),
      ('5.56mm Ammunition', 'AMMUNITION', 'rounds'),
      ('9mm Ammunition', 'AMMUNITION', 'rounds'),
      ('Transport Vehicle', 'VEHICLE', 'vehicles')
     RETURNING id, name`,
  );
  const equipmentId = (name: string) =>
    equipment.rows.find((row) => row.name === name)!.id;

  const [adminHash, commanderHash, logisticsHash] = await Promise.all([
    hashPassword("AdminPass123!"),
    hashPassword("CommandPass123!"),
    hashPassword("LogisticsPass123!"),
  ]);
  const users = await pool.query<{ id: number; username: string }>(
    `INSERT INTO users (username, password_hash, role, base_id) VALUES
      ('admin_user', $1, 'ADMIN', NULL),
      ('commander_alpha', $2, 'BASE_COMMANDER', $3),
      ('logistics_officer', $4, 'LOGISTICS_OFFICER', $3)
     RETURNING id, username`,
    [adminHash, commanderHash, baseId("Fort Alpha"), logisticsHash],
  );
  const userId = (username: string) =>
    users.rows.find((row) => row.username === username)!.id;

  await pool.query(
    `INSERT INTO purchases (base_id, equipment_type_id, quantity, purchase_date, created_by) VALUES
      ($1, $2, 84, CURRENT_DATE - 28, $3),
      ($1, $4, 24000, CURRENT_DATE - 21, $3),
      ($5, $6, 38, CURRENT_DATE - 16, $3),
      ($5, $7, 12000, CURRENT_DATE - 10, $3),
      ($8, $6, 22, CURRENT_DATE - 5, $3)`,
    [
      baseId("Fort Alpha"),
      equipmentId("M4 Carbine"),
      userId("admin_user"),
      equipmentId("5.56mm Ammunition"),
      baseId("Fort Bravo"),
      equipmentId("Humvee"),
      equipmentId("9mm Ammunition"),
      baseId("Fort Charlie"),
    ],
  );

  await pool.query(
    `INSERT INTO transfers (source_base_id, destination_base_id, equipment_type_id, quantity, status, initiated_by) VALUES
      ($1, $2, $3, 18, 'COMPLETED', $4),
      ($2, $1, $5, 4800, 'IN_TRANSIT', $4)`,
    [
      baseId("Fort Alpha"),
      baseId("Fort Bravo"),
      equipmentId("M4 Carbine"),
      userId("logistics_officer"),
      equipmentId("5.56mm Ammunition"),
    ],
  );
  await pool.query(
    `INSERT INTO assignments (base_id, equipment_type_id, personnel_name, quantity, assigned_by)
     VALUES ($1, $2, '2nd Reconnaissance Platoon', 24, $3)`,
    [baseId("Fort Alpha"), equipmentId("M4 Carbine"), userId("commander_alpha")],
  );
  await pool.query(
    `INSERT INTO expenditures (base_id, equipment_type_id, quantity, reason, recorded_by)
     VALUES ($1, $2, 3200, 'Live-fire qualification exercise', $3)`,
    [
      baseId("Fort Alpha"),
      equipmentId("5.56mm Ammunition"),
      userId("commander_alpha"),
    ],
  );
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES
      ($1, 'PURCHASE', 'PURCHASE', NULL, 'Initial inventory received at Fort Alpha'),
      ($2, 'TRANSFER', 'TRANSFER', NULL, 'M4 Carbine movement logged from Fort Alpha to Fort Bravo'),
      ($2, 'ASSIGNMENT', 'ASSIGNMENT', NULL, 'Reconnaissance platoon allocation recorded'),
      ($2, 'EXPENDITURE', 'EXPENDITURE', NULL, 'Live-fire qualification expenditure recorded')`,
    [
      userId("admin_user"),
      userId("commander_alpha"),
    ],
  );
  logger.info("Demo data seeded");
}