import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tileStatus = pgEnum('tile_status', ['queued', 'cooking', 'done', 'failed']);
export const productStatus = pgEnum('product_status', ['live', 'draft', 'archived']);
export const onboardingStep = pgEnum('onboarding_step', [
  'welcome',
  'input',
  'generating',
  'processing',
  'dna',
  'next',
]);
export const assetKind = pgEnum('asset_kind', ['upload', 'generated', 'reference']);
export const assetOwner = pgEnum('asset_owner', ['user', 'brand', 'product', 'tile']);
export const buzzEventKind = pgEnum('buzz_event_kind', ['estimate', 'submit', 'refund']);
export const generationSource = pgEnum('generation_source', [
  'campaign',
  'photoshoot',
  'ad_campaign',
  'adhoc',
  'upscale',
  'animate',
]);
export const generationMediaType = pgEnum('generation_media_type', ['image', 'video']);
export const workflowStatus = pgEnum('workflow_status', [
  'queued',
  'cooking',
  'done',
  'failed',
  'canceled',
]);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    civitaiId: integer('civitai_id'),
    username: text('username'),
    displayName: text('display_name'),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    tier: text('tier'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => ({
    civitaiIdIdx: uniqueIndex('users_civitai_id_uidx').on(t.civitaiId),
    usernameIdx: uniqueIndex('users_username_uidx').on(t.username),
  }),
);

export const onboardingState = pgTable('onboarding_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  currentStep: onboardingStep('current_step').default('welcome').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  payload: jsonb('payload').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const brandProfiles = pgTable(
  'brand_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description'),
    sourceUrl: text('source_url'),
    palette: jsonb('palette').default(sql`'[]'::jsonb`).notNull(),
    tone: text('tone'),
    industry: text('industry'),
    tagline: text('tagline'),
    font: text('font'),
    logoUrl: text('logo_url'),
    values: text('values').array().default(sql`ARRAY[]::text[]`).notNull(),
    aesthetic: text('aesthetic').array().default(sql`ARRAY[]::text[]`).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('brand_profiles_user_idx').on(t.userId),
  }),
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    brandId: uuid('brand_id').references(() => brandProfiles.id, { onDelete: 'set null' }),
    heroAssetId: uuid('hero_asset_id'),
    name: text('name').notNull(),
    sku: text('sku'),
    notes: text('notes'),
    tags: text('tags').array().default(sql`ARRAY[]::text[]`).notNull(),
    status: productStatus('status').default('draft').notNull(),
    usedInCount: integer('used_in_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('products_user_idx').on(t.userId),
    userSkuIdx: uniqueIndex('products_user_sku_uidx').on(t.userId, t.sku),
  }),
);

/**
 * Product-analytics event stream (durable PostHog replacement). The realtime
 * copy goes to Faro/Loki via `track()`; this table is the exact, queryable
 * store for SQL funnels/retention. `event` is free-text (typed at the
 * `track()` boundary) so new events never need a migration.
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userKey: text('user_key')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    event: text('event').notNull(),
    props: jsonb('props').default(sql`'{}'::jsonb`).notNull(),
    sessionId: text('session_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('analytics_events_user_idx').on(t.userKey),
    eventIdx: index('analytics_events_event_idx').on(t.event),
    occurredIdx: index('analytics_events_occurred_idx').on(t.occurredAt),
  }),
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    kind: assetKind('kind').notNull(),
    ownerType: assetOwner('owner_type'),
    brandId: uuid('brand_id').references(() => brandProfiles.id, { onDelete: 'set null' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    bucket: text('bucket').notNull(),
    storageKey: text('storage_key').notNull(),
    publicUrl: text('public_url'),
    contentType: text('content_type'),
    byteSize: integer('byte_size'),
    width: integer('width'),
    height: integer('height'),
    sha256: text('sha256'),
    dominantColor: text('dominant_color'),
    palette: jsonb('palette'),
    vlmTags: jsonb('vlm_tags'),
    workflowId: text('workflow_id'),
    sourceTileId: uuid('source_tile_id'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('assets_user_idx').on(t.userId),
    brandIdx: index('assets_brand_idx').on(t.brandId),
    productIdx: index('assets_product_idx').on(t.productId),
    workflowIdx: index('assets_workflow_idx').on(t.workflowId),
    storageUniq: uniqueIndex('assets_bucket_key_uidx').on(t.bucket, t.storageKey),
  }),
);

export const productAssets = pgTable(
  'product_assets',
  {
    productId: uuid('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    assetId: uuid('asset_id')
      .references(() => assets.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').default('reference').notNull(),
    position: integer('position').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.productId, t.assetId] }),
    assetIdx: index('product_assets_asset_idx').on(t.assetId),
  }),
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    brandId: uuid('brand_id').references(() => brandProfiles.id, { onDelete: 'set null' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    brief: jsonb('brief').notNull(),
    presetIds: text('preset_ids').array().default(sql`ARRAY[]::text[]`).notNull(),
    referenceAssetIds: text('reference_asset_ids').array().default(sql`ARRAY[]::text[]`).notNull(),
    variantsPerPreset: integer('variants_per_preset').default(1).notNull(),
    enhancedPrompts: jsonb('enhanced_prompts'),
    audience: text('audience'),
    aesthetics: text('aesthetics'),
    industry: text('industry'),
    goal: text('goal'),
    channels: text('channels').array(),
    estimatedBuzz: integer('estimated_buzz').default(0).notNull(),
    actualBuzz: integer('actual_buzz').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index('campaigns_user_created_idx').on(t.userId, t.createdAt),
  }),
);

export const campaignTiles = pgTable(
  'campaign_tiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    campaignId: uuid('campaign_id')
      .references(() => campaigns.id, { onDelete: 'cascade' })
      .notNull(),
    presetId: text('preset_id').notNull(),
    // Nullable: a `failed` tile (submit rejected at cook time) has no workflow
    // yet. Regenerate populates it. The unique index treats NULLs as distinct,
    // so multiple failed tiles coexist.
    workflowId: text('workflow_id'),
    prompt: text('prompt').notNull(),
    seed: text('seed'),
    quantity: integer('quantity').default(1).notNull(),
    variantGroupId: uuid('variant_group_id'),
    variantIndex: integer('variant_index').default(0).notNull(),
    status: tileStatus('status').default('cooking').notNull(),
    estimatedBuzz: integer('estimated_buzz').default(0).notNull(),
    actualBuzz: integer('actual_buzz').default(0).notNull(),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    adCopy: jsonb('ad_copy'),
    palette: jsonb('palette'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    campaignIdx: index('campaign_tiles_campaign_idx').on(t.campaignId),
    workflowIdx: uniqueIndex('campaign_tiles_workflow_uidx').on(t.workflowId),
    variantGroupIdx: index('campaign_tiles_variant_group_idx').on(
      t.campaignId,
      t.variantGroupId,
      t.variantIndex,
    ),
  }),
);

export const tileVersions = pgTable(
  'tile_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tileId: uuid('tile_id')
      .references(() => campaignTiles.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    workflowId: text('workflow_id').notNull(),
    prompt: text('prompt').notNull(),
    adCopy: jsonb('ad_copy'),
    palette: jsonb('palette'),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    changeNote: text('change_note'),
    generationId: text('generation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tileIdx: index('tile_versions_tile_idx').on(t.tileId, t.version),
    tileVersionUidx: uniqueIndex('tile_versions_tile_version_uidx').on(t.tileId, t.version),
  }),
);

export const photoshoots = pgTable(
  'photoshoots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    brief: jsonb('brief').notNull(),
    ratio: text('ratio').notNull(),
    variantsPerTemplate: integer('variants_per_template').default(1).notNull(),
    templateIds: text('template_ids').array().default(sql`ARRAY[]::text[]`).notNull(),
    referenceAssetIds: text('reference_asset_ids').array().default(sql`ARRAY[]::text[]`).notNull(),
    enhancedPrompts: jsonb('enhanced_prompts'),
    estimatedBuzz: integer('estimated_buzz').default(0).notNull(),
    actualBuzz: integer('actual_buzz').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userCreatedIdx: index('photoshoots_user_created_idx').on(t.userId, t.createdAt),
  }),
);

export const photoshootTiles = pgTable(
  'photoshoot_tiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    photoshootId: uuid('photoshoot_id')
      .references(() => photoshoots.id, { onDelete: 'cascade' })
      .notNull(),
    templateId: text('template_id').notNull(),
    variantIndex: integer('variant_index').default(0).notNull(),
    workflowId: text('workflow_id').notNull(),
    prompt: text('prompt').notNull(),
    seed: text('seed'),
    quantity: integer('quantity').default(1).notNull(),
    status: tileStatus('status').default('cooking').notNull(),
    estimatedBuzz: integer('estimated_buzz').default(0).notNull(),
    actualBuzz: integer('actual_buzz').default(0).notNull(),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    photoshootIdx: index('photoshoot_tiles_shoot_idx').on(t.photoshootId),
    workflowIdx: uniqueIndex('photoshoot_tiles_workflow_uidx').on(t.workflowId),
  }),
);

export const generations = pgTable(
  'generations',
  {
    workflowId: text('workflow_id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    source: generationSource('source').notNull(),
    sourceId: uuid('source_id'),
    tileId: uuid('tile_id'),
    parentWorkflowId: text('parent_workflow_id'),
    parentImageIndex: integer('parent_image_index'),
    mediaType: generationMediaType('media_type').default('image').notNull(),
    status: workflowStatus('status').default('queued').notNull(),
    prompt: text('prompt'),
    input: jsonb('input').notNull(),
    snapshot: jsonb('snapshot'),
    estimatedBuzz: integer('estimated_buzz').default(0).notNull(),
    chargedBuzz: integer('charged_buzz').default(0).notNull(),
    error: text('error'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('generations_user_idx').on(t.userId, t.submittedAt),
    sourceIdx: index('generations_source_idx').on(t.source, t.sourceId),
    parentIdx: index('generations_parent_idx').on(t.parentWorkflowId),
  }),
);

export const buzzEvents = pgTable(
  'buzz_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workflowId: text('workflow_id'),
    kind: buzzEventKind('kind').notNull(),
    estimated: integer('estimated').default(0).notNull(),
    charged: integer('charged').default(0).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('buzz_events_user_idx').on(t.userId, t.createdAt),
    workflowIdx: index('buzz_events_workflow_idx').on(t.workflowId),
    // At most one `submit` (the authoritative charge) per workflow. This is the
    // DB-level backstop for the "charge buzz once" invariant: concurrent
    // terminal polls of the same workflow can no longer insert duplicate
    // charge rows that corrupt the user-facing "buzz spent" total.
    submitOnce: uniqueIndex('buzz_events_submit_once')
      .on(t.workflowId)
      .where(sql`${t.kind} = 'submit'`),
  }),
);

/**
 * Fixed-window rate-limit counters. One row per limiter key
 * (e.g. `cook:<userId>`, `login:<ip>`). Updated via a single atomic upsert in
 * lib/rateLimit.ts — correct across concurrent requests and app instances.
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).defaultNow().notNull(),
  count: integer('count').default(0).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type BrandProfile = typeof brandProfiles.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignTile = typeof campaignTiles.$inferSelect;
export type NewCampaignTile = typeof campaignTiles.$inferInsert;
export type Photoshoot = typeof photoshoots.$inferSelect;
export type NewPhotoshoot = typeof photoshoots.$inferInsert;
export type PhotoshootTile = typeof photoshootTiles.$inferSelect;
export type NewPhotoshootTile = typeof photoshootTiles.$inferInsert;
export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;
export type BuzzEvent = typeof buzzEvents.$inferSelect;
export type NewBuzzEvent = typeof buzzEvents.$inferInsert;
export type OnboardingState = typeof onboardingState.$inferSelect;
export type TileVersion = typeof tileVersions.$inferSelect;
export type NewTileVersion = typeof tileVersions.$inferInsert;
export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
