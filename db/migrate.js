#!/usr/bin/env node
/**
 * migrate.js
 * Runs all 13 GTM Autopilot migrations against Supabase in order.
 * 
 * Usage:
 *   node db/migrate.js
 *
 * Requires in .env:
 *   SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@db.urdhebsbnjbtdnookwmk.supabase.co:5432/postgres
 *   (Get the password from: Supabase Dashboard → Project Settings → Database → Database password)
 */

import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '..', '.env') })

const { Client } = pg

const DB_URL = process.env.SUPABASE_DB_URL

if (!DB_URL) {
  console.error('\n❌ SUPABASE_DB_URL is not set in .env')
  console.error('\nGet the connection string from:')
  console.error('  Supabase Dashboard → Project Settings → Database → Connection string → URI')
  console.error('\nFormat: postgresql://postgres:[YOUR-DB-PASSWORD]@db.urdhebsbnjbtdnookwmk.supabase.co:5432/postgres')
  console.error('\nAdd to .env: SUPABASE_DB_URL=postgresql://postgres:[password]@db.urdhebsbnjbtdnookwmk.supabase.co:5432/postgres\n')
  process.exit(1)
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

const MIGRATIONS = [
  '001_organizations.sql',
  '002_leads.sql',
  '003_companies.sql',
  '004_external_identity.sql',
  '005_evidence.sql',
  '006_policy_rules.sql',
  '007_action_risk_registry.sql',
  '008_play_instance.sql',
  '009_event_log.sql',
  '010_action_execution_state.sql',
  '011_connector_config.sql',
  '012_routing_state.sql',
  '013_rls_policies.sql',
]

async function runMigration(client, filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename)
  const sql = fs.readFileSync(filepath, 'utf8')
  
  // Strip rollback section (everything after -- ROLLBACK)
  const forwardSql = sql.split('-- ROLLBACK')[0].trim()
  
  await client.query(forwardSql)
}

async function verify(client) {
  const checks = []
  
  // 1. event_log has NO updated_at
  const noUpdatedAt = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'event_log' AND column_name = 'updated_at'
  `)
  checks.push({
    name: 'event_log: NO updated_at column',
    passed: noUpdatedAt.rows.length === 0
  })
  
  // 2. decision_snapshot is NOT NULL
  const snapshotCheck = await client.query(`
    SELECT is_nullable FROM information_schema.columns 
    WHERE table_name = 'event_log' AND column_name = 'decision_snapshot'
  `)
  checks.push({
    name: 'event_log.decision_snapshot: JSONB NOT NULL',
    passed: snapshotCheck.rows[0]?.is_nullable === 'NO'
  })
  
  // 3. organization_id on every non-root table
  const tables = [
    'leads', 'companies', 'external_identity', 'evidence',
    'policy_rules', 'action_risk_registry', 'play_instance', 'event_log',
    'action_execution_state', 'connector_config', 'routing_state'
  ]
  for (const table of tables) {
    const result = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = 'organization_id'
    `, [table])
    checks.push({
      name: `${table}.organization_id: present`,
      passed: result.rows.length > 0
    })
  }
  
  // 4. All 12 tables exist
  const allTables = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `)
  const tableNames = allTables.rows.map(r => r.table_name)
  checks.push({
    name: `All 12 tables created: ${tableNames.join(', ')}`,
    passed: tableNames.length >= 12
  })
  
  return checks
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(' GTM Autopilot — Running Migrations')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  })

  try {
    console.log('Connecting to Supabase...')
    await client.connect()
    console.log('✓ Connected\n')

    for (const migration of MIGRATIONS) {
      process.stdout.write(`▶ Running ${migration} ... `)
      try {
        await runMigration(client, migration)
        console.log('✓ SUCCESS')
      } catch (err) {
        // Check if it's "already exists" — safe to skip
        if (err.message.includes('already exists')) {
          console.log('⟳ SKIPPED (already exists)')
        } else {
          console.log(`✗ FAILED\n\nError: ${err.message}\n`)
          throw err
        }
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(' Verifying schema integrity...')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    const checks = await verify(client)
    let allPassed = true

    for (const check of checks) {
      const icon = check.passed ? '✓' : '✗'
      console.log(`  ${icon} ${check.name}`)
      if (!check.passed) allPassed = false
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    if (allPassed) {
      console.log(' ✅ All 13 migrations complete. All checks passed.')
      console.log(' Ready to merge feat/schema → main.')
    } else {
      console.log(' ❌ Some checks failed. Do not merge until resolved.')
      process.exit(1)
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  } catch (err) {
    if (err.message.includes('connect')) {
      console.error('\n❌ Could not connect to database.')
      console.error('Check that SUPABASE_DB_URL in .env has the correct password.')
      console.error('Get it from: Supabase Dashboard → Project Settings → Database → Database password\n')
    }
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
