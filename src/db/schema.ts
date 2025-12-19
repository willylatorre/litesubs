import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export * from './auth-schema'

export const todos = pgTable('todos', {
  id: serial().primaryKey(),
  title: text().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})
