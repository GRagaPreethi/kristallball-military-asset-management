import {
  date,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const basesTable = pgTable(
  "bases",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    location: text("location").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("bases_name_idx").on(table.name)],
);

export const equipmentTypesTable = pgTable(
  "equipment_types",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    category: text("category").notNull(),
    unit: text("unit").notNull().default("units"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("equipment_types_category_idx").on(table.category)],
);

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    baseId: integer("base_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (table) => [index("users_base_idx").on(table.baseId)],
);

export const purchasesTable = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    baseId: integer("base_id").notNull(),
    equipmentTypeId: integer("equipment_type_id").notNull(),
    quantity: integer("quantity").notNull(),
    purchaseDate: date("purchase_date", { mode: "string" }).notNull(),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("purchases_base_idx").on(table.baseId),
    index("purchases_equipment_idx").on(table.equipmentTypeId),
    index("purchases_created_idx").on(table.createdAt),
  ],
);

export const transfersTable = pgTable(
  "transfers",
  {
    id: serial("id").primaryKey(),
    sourceBaseId: integer("source_base_id").notNull(),
    destinationBaseId: integer("destination_base_id").notNull(),
    equipmentTypeId: integer("equipment_type_id").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("COMPLETED"),
    initiatedBy: integer("initiated_by").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("transfers_source_idx").on(table.sourceBaseId),
    index("transfers_destination_idx").on(table.destinationBaseId),
    index("transfers_equipment_idx").on(table.equipmentTypeId),
    index("transfers_timestamp_idx").on(table.timestamp),
  ],
);

export const assignmentsTable = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    baseId: integer("base_id").notNull(),
    equipmentTypeId: integer("equipment_type_id").notNull(),
    personnelName: text("personnel_name").notNull(),
    quantity: integer("quantity").notNull(),
    assignedBy: integer("assigned_by").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("assignments_base_idx").on(table.baseId),
    index("assignments_equipment_idx").on(table.equipmentTypeId),
    index("assignments_assigned_idx").on(table.assignedAt),
  ],
);

export const expendituresTable = pgTable(
  "expenditures",
  {
    id: serial("id").primaryKey(),
    baseId: integer("base_id").notNull(),
    equipmentTypeId: integer("equipment_type_id").notNull(),
    quantity: integer("quantity").notNull(),
    reason: text("reason").notNull(),
    recordedBy: integer("recorded_by").notNull(),
    expendedAt: timestamp("expended_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("expenditures_base_idx").on(table.baseId),
    index("expenditures_equipment_idx").on(table.equipmentTypeId),
    index("expenditures_expended_idx").on(table.expendedAt),
  ],
);

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    details: text("details").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_user_idx").on(table.userId),
    index("audit_logs_created_idx").on(table.createdAt),
  ],
);

export const insertBaseSchema = createInsertSchema(basesTable).omit({ id: true, createdAt: true });
export const insertEquipmentTypeSchema = createInsertSchema(equipmentTypesTable).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true, lastActiveAt: true });
export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({ id: true, createdAt: true });
export const insertTransferSchema = createInsertSchema(transfersTable).omit({ id: true, timestamp: true });
export const insertAssignmentSchema = createInsertSchema(assignmentsTable).omit({ id: true, assignedAt: true });
export const insertExpenditureSchema = createInsertSchema(expendituresTable).omit({ id: true, expendedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });

export type Base = typeof basesTable.$inferSelect;
export type EquipmentType = typeof equipmentTypesTable.$inferSelect;
export type User = typeof usersTable.$inferSelect;
export type Purchase = typeof purchasesTable.$inferSelect;
export type Transfer = typeof transfersTable.$inferSelect;
export type Assignment = typeof assignmentsTable.$inferSelect;
export type Expenditure = typeof expendituresTable.$inferSelect;
export type AuditLog = typeof auditLogsTable.$inferSelect;

export type InsertBase = z.infer<typeof insertBaseSchema>;
export type InsertEquipmentType = z.infer<typeof insertEquipmentTypeSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type InsertTransfer = z.infer<typeof insertTransferSchema>;
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type InsertExpenditure = z.infer<typeof insertExpenditureSchema>;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;