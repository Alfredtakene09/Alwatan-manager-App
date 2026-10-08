import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRememberedManualOperationCode } from "./manual-service-operation.js";

describe("isRememberedManualOperationCode", () => {
  it("reconnaît un acte saisi dans les champs", () => {
    assert.equal(isRememberedManualOperationCode("OPM-APPENDICECTOMIE-M5K2L8Q"), true);
    assert.equal(isRememberedManualOperationCode("OP-APPENDICECTOMIE-M5K2L8Q"), true);
  });

  it("laisse les tarifs officiels inchangés", () => {
    assert.equal(isRememberedManualOperationCode("OP-GYN-CESAR"), false);
    assert.equal(isRememberedManualOperationCode("OP-GYN-CESAR-EM"), false);
    assert.equal(isRememberedManualOperationCode("OP-ORTHO-HANCHE"), false);
  });
});
