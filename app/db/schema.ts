import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

// Re-export auth schema
export * from './auth-schema'

// Enums
export const productTypeEnum = pgEnum('product_type', ['one_time', 'recurring'])
export const transactionTypeEnum = pgEnum('transaction_type', [
  'purchase',
  'manual_adjustment',
  'usage',
  'refund',
])
export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'rejected'])
export const currencyEnum = pgEnum('currency', ['usd', 'eur'])

// Tables

export const products = pgTable('products', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  creatorId: text('creator_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  price: integer('price').notNull(), // stored in cents
  currency: currencyEnum('currency').default('usd').notNull(),
  credits: integer('credits').notNull(), // amount of credits granted
  type: productTypeEnum('type').default('one_time').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index('product_creator_idx').on(table.creatorId),
  index('product_created_at_idx').on(table.createdAt),
])

export const userBalances = pgTable(
  'user_balances',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }), // The customer
    creatorId: text('creator_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }), // The owner of the credits context
    credits: integer('credits').default(0).notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('user_creator_balance_idx').on(table.userId, table.creatorId),
    index('balance_user_idx').on(table.userId),
    index('balance_creator_idx').on(table.creatorId),
  ]
)

export const transactions = pgTable(
  'transactions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    amount: integer('amount').notNull(), // Positive for add, negative for remove/usage
    type: transactionTypeEnum('type').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('tx_user_idx').on(table.userId),
    index('tx_creator_idx').on(table.creatorId),
    index('tx_product_idx').on(table.productId),
    index('tx_created_at_idx').on(table.createdAt),
  ]
)

export const invites = pgTable('invites', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  creatorId: text('creator_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  email: text('email'),
  status: inviteStatusEnum('status').default('pending').notNull(),
  token: text('token').notNull().unique(), // unique string for the link
  productId: text('product_id').references(() => products.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index('invite_creator_idx').on(table.creatorId),
  index('invite_email_idx').on(table.email),
])

// Relations

export const productsRelations = relations(products, ({ one, many }) => ({
  creator: one(user, {
    fields: [products.creatorId],
    references: [user.id],
  }),
  transactions: many(transactions),
}))

export const userBalancesRelations = relations(userBalances, ({ one }) => ({
  user: one(user, {
    fields: [userBalances.userId],
    references: [user.id],
    relationName: 'customerBalance',
  }),
  creator: one(user, {
    fields: [userBalances.creatorId],
    references: [user.id],
    relationName: 'creatorManagedBalance',
  }),
}))

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(user, {
    fields: [transactions.userId],
    references: [user.id],
  }),
  creator: one(user, {
    fields: [transactions.creatorId],
    references: [user.id],
  }),
  product: one(products, {
    fields: [transactions.productId],
    references: [products.id],
  }),
}))

export const invitesRelations = relations(invites, ({ one }) => ({
  creator: one(user, {
    fields: [invites.creatorId],
    references: [user.id],
  }),
  product: one(products, {
    fields: [invites.productId],
    references: [products.id],
  }),
}))