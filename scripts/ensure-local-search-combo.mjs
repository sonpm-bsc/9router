#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const COMBO_ID = "b6382904-b00a-4113-9583-ed06fdae455f";
const COMBO_NAME = "9R_search_combo";
const COMBO_KIND = "webSearch";
const DESIRED_MODELS = ["searxng", "brave-search", "tavily", "exa", "gemini"];
const LEGACY_MODELS = ["gemini", "brave-search", "tavily", "exa"];

function usage() {
  console.log(`Usage: node scripts/ensure-local-search-combo.mjs [options]

Options:
  --db <path>   SQLite path (default: DATA_DIR/db/data.sqlite)
  --dry-run     Inspect and report without changing SQLite
  --help        Show this help
`);
}

function parseArgs(argv) {
  const args = { dryRun: false, dbPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--db") {
      args.dbPath = argv[++i];
      if (!args.dbPath) throw new Error("--db requires a path");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function defaultDbPath() {
  const dataDir = process.env.DATA_DIR || path.join(os.homedir(), ".9router");
  return path.join(dataDir, "db", "data.sqlite");
}

function parseModels(raw) {
  try {
    const models = JSON.parse(raw);
    if (!Array.isArray(models) || !models.every((model) => typeof model === "string")) {
      throw new Error("models is not a string array");
    }
    return models;
  } catch (error) {
    throw new Error(`invalid combo models JSON: ${error.message}`);
  }
}

function sameModels(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath || defaultDbPath();
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (error) {
    throw new Error(`better-sqlite3 is required to manage the runtime DB: ${error.message}`);
  }

  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");

  try {
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    );
    for (const requiredTable of ["combos", "providerConnections"]) {
      if (!tables.has(requiredTable)) throw new Error(`missing required table: ${requiredTable}`);
    }

    const readCombo = db.prepare(
      "SELECT id, name, kind, models, createdAt, updatedAt FROM combos WHERE name = ?"
    );
    const readById = db.prepare("SELECT id, name FROM combos WHERE id = ?");
    const searxngConnections = db
      .prepare("SELECT COUNT(*) AS count FROM providerConnections WHERE provider = ?")
      .get("searxng").count;
    const existing = readCombo.get(COMBO_NAME);

    if (existing && existing.id !== COMBO_ID) {
      throw new Error(`combo name exists with unexpected id: ${existing.id}`);
    }
    const idCollision = readById.get(COMBO_ID);
    if (idCollision && idCollision.name !== COMBO_NAME) {
      throw new Error(`combo id belongs to another name: ${idCollision.name}`);
    }

    const currentModels = existing ? parseModels(existing.models) : null;
    if (existing && existing.kind !== COMBO_KIND) {
      throw new Error(`combo has unexpected kind: ${existing.kind}`);
    }
    if (existing && !sameModels(currentModels, DESIRED_MODELS) && !sameModels(currentModels, LEGACY_MODELS)) {
      throw new Error(`combo has unexpected models: ${JSON.stringify(currentModels)}`);
    }

    let status = "unchanged";
    let result;
    if (!args.dryRun) {
      const apply = db.transaction(() => {
        const row = readCombo.get(COMBO_NAME);
        if (row && row.models !== JSON.stringify(currentModels)) {
          throw new Error("combo changed during preflight; refusing to overwrite");
        }
        const now = new Date().toISOString();
        if (!row) {
          db.prepare(
            "INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)"
          ).run(COMBO_ID, COMBO_NAME, COMBO_KIND, JSON.stringify(DESIRED_MODELS), now, now);
          status = "created";
        } else if (!sameModels(currentModels, DESIRED_MODELS)) {
          const update = db.prepare(
            "UPDATE combos SET models = ?, updatedAt = ? WHERE id = ? AND name = ? AND models = ?"
          ).run(JSON.stringify(DESIRED_MODELS), now, COMBO_ID, COMBO_NAME, row.models);
          if (update.changes !== 1) throw new Error("combo update was not applied");
          status = "updated";
        }
        return db.prepare(
          "SELECT id, name, kind, models, createdAt, updatedAt FROM combos WHERE name = ?"
        ).get(COMBO_NAME);
      });
      result = apply();
    } else {
      result = existing || {
        id: COMBO_ID,
        name: COMBO_NAME,
        kind: COMBO_KIND,
        models: JSON.stringify(DESIRED_MODELS),
      };
      if (!existing) status = "would-create";
      else if (!sameModels(currentModels, DESIRED_MODELS)) status = "would-update";
    }

    console.log(JSON.stringify({
      status,
      dryRun: args.dryRun,
      combo: {
        id: result.id,
        name: result.name,
        kind: result.kind,
        models: parseModels(result.models),
        updatedAt: result.updatedAt || null,
      },
      searxngConnections,
      warning: searxngConnections > 0 ? "SearXNG is noAuth; existing connection rows were not changed" : null,
    }, null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`[ensure-local-search-combo] ${error.message}`);
  process.exitCode = 1;
}
