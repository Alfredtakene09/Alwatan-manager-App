import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDeleteLikeRequest, isRemoteAccess, isTailscaleAddress } from "./remote-access.js";

describe("remote-access", () => {
  it("reconnaît les adresses Tailscale", () => {
    assert.equal(isTailscaleAddress("100.101.5.7"), true);
    assert.equal(isTailscaleAddress("::ffff:100.64.0.1"), true);
    assert.equal(isTailscaleAddress("fd7a:115c:a1e0::1234"), true);
    assert.equal(isTailscaleAddress("100.200.1.1"), false);
    assert.equal(isTailscaleAddress("192.168.1.10"), false);
  });

  it("considère le LAN et le poste serveur comme locaux", () => {
    for (const socketAddress of ["127.0.0.1", "::1", "::ffff:192.168.1.20", "10.0.0.5", "172.20.1.1"]) {
      assert.equal(isRemoteAccess({ socketAddress, host: "192.168.1.2:4000" }), false, socketAddress);
    }
  });

  it("détecte Tailscale par IP, Host, proxy ou IP publique", () => {
    assert.equal(isRemoteAccess({ socketAddress: "100.88.1.2" }), true);
    assert.equal(isRemoteAccess({ socketAddress: "192.168.1.5", host: "serveur.tail1234.ts.net" }), true);
    assert.equal(isRemoteAccess({ socketAddress: "192.168.1.5", host: "100.90.3.4:4000" }), true);
    assert.equal(isRemoteAccess({ socketAddress: "127.0.0.1", tailscaleHeader: true }), true);
    assert.equal(isRemoteAccess({ socketAddress: "127.0.0.1", forwardedFor: "100.70.0.9" }), true);
    assert.equal(isRemoteAccess({ socketAddress: "41.202.10.3" }), true);
  });

  it("repère les suppressions (DELETE et suppressions logiques)", () => {
    assert.equal(isDeleteLikeRequest("DELETE", "/api/patients/12"), true);
    assert.equal(isDeleteLikeRequest("POST", "/api/pharmacie/products/remove-expired"), true);
    assert.equal(isDeleteLikeRequest("PATCH", "/api/cash-desk/expenses/3/deactivate"), true);
    assert.equal(isDeleteLikeRequest("PATCH", "/api/gestionnaire/expense-categories/3/archive"), true);
    assert.equal(isDeleteLikeRequest("PATCH", "/api/admin/salary-advances/3/cancel"), true);
    assert.equal(isDeleteLikeRequest("GET", "/api/patients/delete"), false);
    assert.equal(isDeleteLikeRequest("POST", "/api/patients"), false);
    assert.equal(isDeleteLikeRequest("PATCH", "/api/visits/5"), false);
  });
});
