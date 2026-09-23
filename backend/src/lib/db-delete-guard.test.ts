import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExternalDataDeleteBlockedError,
  isAppDataDeleteAllowed,
  runWithAppDataDeleteUnlock,
} from "./db-delete-guard.js";

describe("db-delete-guard", () => {
  it("refuse les suppressions hors contexte application", () => {
    assert.equal(isAppDataDeleteAllowed(), false);
  });

  it("autorise dans le contexte api / startup / script", () => {
    runWithAppDataDeleteUnlock("api", () => {
      assert.equal(isAppDataDeleteAllowed(), true);
    });
    runWithAppDataDeleteUnlock("startup", () => {
      assert.equal(isAppDataDeleteAllowed(), true);
    });
    runWithAppDataDeleteUnlock("script", () => {
      assert.equal(isAppDataDeleteAllowed(), true);
    });
    assert.equal(isAppDataDeleteAllowed(), false);
  });

  it("expose un code d'erreur stable", () => {
    const err = new ExternalDataDeleteBlockedError();
    assert.equal(err.code, "EXTERNAL_DELETE_BLOCKED");
  });
});
