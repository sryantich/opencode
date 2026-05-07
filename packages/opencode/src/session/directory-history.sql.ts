import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"

export const SessionDirectoryHistoryTable = sqliteTable(
  "session_directory_history",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    from_directory: text(),
    to_directory: text().notNull(),
    from_project_id: text(),
    to_project_id: text().notNull(),
    actor: text().notNull(),
    reason: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("session_directory_history_session_idx").on(table.session_id, table.time_created)],
)
