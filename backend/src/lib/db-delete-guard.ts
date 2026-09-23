import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";

/**
 * Verrou anti-suppression hors application.
 *
 * - PostgreSQL : triggers DELETE / TRUNCATE + event trigger DROP
 *   exigent `alwatan.allow_delete = '1'` (GUC de transaction).
 * - Node : seules les requêtes API (et démarrage / scripts confirmés)
 *   peuvent poser ce GUC via le client Prisma étendu.
 *
 * Contournement maintenance (psql) :
 *   SELECT set_config('alwatan.allow_delete', '1', false);
 *
 * Pour `prisma db push` : npm run db:push (scripts/db-push-safe.ts).
 */

export type AppDeleteContext = {
  /** api = boutons/routes Express ; startup = seeds ; script = CLI confirmé */
  source: "api" | "startup" | "script";
};

export const appDeleteContext = new AsyncLocalStorage<AppDeleteContext>();

/** Indique qu’on est déjà dans une $transaction ayant posé le GUC. */
const guardedTxContext = new AsyncLocalStorage<boolean>();

export function runWithAppDataDeleteUnlock<T>(
  source: AppDeleteContext["source"],
  fn: () => T,
): T {
  return appDeleteContext.run({ source }, fn);
}

export function isAppDataDeleteAllowed(): boolean {
  const ctx = appDeleteContext.getStore();
  return ctx?.source === "api" || ctx?.source === "startup" || ctx?.source === "script";
}

export class ExternalDataDeleteBlockedError extends Error {
  readonly code = "EXTERNAL_DELETE_BLOCKED";
  constructor(message?: string) {
    super(
      message ??
        "Suppression de données interdite hors de l’application Alwatan (boutons / API).",
    );
    this.name = "ExternalDataDeleteBlockedError";
  }
}

function isDeleteOperation(operation: string): boolean {
  return operation === "delete" || operation === "deleteMany";
}

/** SQL idempotent : fonctions + triggers sur toutes les tables public. */
export const DB_DELETE_GUARD_STATEMENTS: string[] = [
  `
CREATE OR REPLACE FUNCTION alwatan_guard_row_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('alwatan.allow_delete', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION
      'ALWATAN_LOCK: suppression interdite hors application (table %). Utilisez l''interface Alwatan, ou en maintenance: SELECT set_config(''alwatan.allow_delete'', ''1'', false);',
      TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
`,
  `
CREATE OR REPLACE FUNCTION alwatan_guard_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('alwatan.allow_delete', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION
      'ALWATAN_LOCK: TRUNCATE interdit hors application (table %).',
      TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;
`,
  `
CREATE OR REPLACE FUNCTION alwatan_guard_sql_drop()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obj record;
BEGIN
  IF current_setting('alwatan.allow_delete', true) IS DISTINCT FROM '1' THEN
    FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
    LOOP
      IF obj.object_type IN ('table', 'view', 'foreign table', 'matview', 'schema') THEN
        RAISE EXCEPTION
          'ALWATAN_LOCK: DROP % "%" interdit hors application Alwatan.',
          obj.object_type, obj.object_identity
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
END;
$$;
`,
  `
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS alwatan_block_delete ON %I',
      r.tablename
    );
    EXECUTE format(
      'CREATE TRIGGER alwatan_block_delete
         BEFORE DELETE ON %I
         FOR EACH ROW
         EXECUTE PROCEDURE alwatan_guard_row_delete()',
      r.tablename
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS alwatan_block_truncate ON %I',
      r.tablename
    );
    EXECUTE format(
      'CREATE TRIGGER alwatan_block_truncate
         BEFORE TRUNCATE ON %I
         FOR EACH STATEMENT
         EXECUTE PROCEDURE alwatan_guard_truncate()',
      r.tablename
    );
  END LOOP;
END;
$$;
`,
  `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_event_trigger WHERE evtname = 'alwatan_block_sql_drop'
  ) THEN
    CREATE EVENT TRIGGER alwatan_block_sql_drop
      ON sql_drop
      EXECUTE PROCEDURE alwatan_guard_sql_drop();
  END IF;
END;
$$;
`,
];

export async function ensureDbDeleteGuard(prisma: PrismaClient): Promise<void> {
  for (const sql of DB_DELETE_GUARD_STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }
}

function modelDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Enveloppe le client Prisma :
 * - refuse delete/deleteMany hors contexte app
 * - pose le GUC une fois par $transaction (atomicité conservée)
 * - enveloppe les delete isolés dans une transaction
 */
export function extendPrismaWithDeleteGuard(base: PrismaClient): PrismaClient {
  const extended = base.$extends({
    client: {
      $transaction(...args: unknown[]) {
        const first = args[0];

        if (typeof first === "function") {
          const fn = first as (tx: unknown) => Promise<unknown>;
          const options = args[1];
          return (base.$transaction as Function)(
            async (tx: unknown) => {
              if (isAppDataDeleteAllowed()) {
                await (tx as PrismaClient).$executeRaw`
                  SELECT set_config('alwatan.allow_delete', '1', true)
                `;
              }
              return guardedTxContext.run(true, () => fn(tx));
            },
            options,
          );
        }

        // Forme tableau : GUC en première opération + contexte pour éviter une sous-transaction.
        if (Array.isArray(first)) {
          const operations = first as unknown[];
          const options = args[1];
          return guardedTxContext.run(true, () => {
            if (isAppDataDeleteAllowed()) {
              return (base.$transaction as Function)(
                [
                  base.$executeRaw`SELECT set_config('alwatan.allow_delete', '1', true)`,
                  ...operations,
                ],
                options,
              );
            }
            return (base.$transaction as Function)(operations, options);
          });
        }

        return (base.$transaction as Function).apply(base, args);
      },
    },
    query: {
      async $allOperations({ operation, model, args, query }) {
        if (!isDeleteOperation(operation)) {
          return query(args);
        }

        if (!isAppDataDeleteAllowed()) {
          throw new ExternalDataDeleteBlockedError();
        }

        if (guardedTxContext.getStore()) {
          return query(args);
        }

        if (!model) {
          throw new ExternalDataDeleteBlockedError(
            "Suppression raw/non modèle refusée hors déverrouillage explicite.",
          );
        }

        // Delete hors $transaction : GUC + delete sur la même connexion (client de base).
        return base.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('alwatan.allow_delete', '1', true)`;
          const delegate = (
            tx as unknown as Record<string, { delete: Function; deleteMany: Function }>
          )[modelDelegateName(model)];
          if (operation === "delete") {
            return delegate.delete(args);
          }
          return delegate.deleteMany(args);
        });
      },
    },
  });

  return extended as unknown as PrismaClient;
}
