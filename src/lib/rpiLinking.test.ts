import { describe, expect, it } from "vitest";
import {
  isDocumentEligibleDispatchCode,
  normalizeDispatchCode,
  normalizePatentNumberKey,
  shouldCreatePatentFromHistory,
} from "./rpiLinking";

describe("rpi linking rules", () => {
  it("normaliza número de patente para chave única", () => {
    expect(normalizePatentNumberKey("BR 11 2019 005296-2")).toBe("BR1120190052962");
    expect(normalizePatentNumberKey(" pi 1005510-3 ")).toBe("PI10055103");
  });

  it("normaliza código de despacho", () => {
    expect(normalizeDispatchCode(" 3,1 ")).toBe("3.1");
    expect(normalizeDispatchCode("16.1")).toBe("16.1");
  });

  it("enfileira documentos apenas para 3.1 e 16.1", () => {
    expect(isDocumentEligibleDispatchCode("3.1")).toBe(true);
    expect(isDocumentEligibleDispatchCode("3,1")).toBe(true);
    expect(isDocumentEligibleDispatchCode("16.1")).toBe(true);
    expect(isDocumentEligibleDispatchCode("9.2")).toBe(false);
  });

  it("só cria patente quando há número e despacho elegível", () => {
    expect(shouldCreatePatentFromHistory({ patentNumberRaw: "BR1120190052962", dispatchCode: "3.1" })).toBe(true);
    expect(shouldCreatePatentFromHistory({ patentNumberRaw: "BR1120190052962", dispatchCode: "16.1" })).toBe(true);
    expect(shouldCreatePatentFromHistory({ patentNumberRaw: "BR1120190052962", dispatchCode: "5.2" })).toBe(false);
    expect(shouldCreatePatentFromHistory({ patentNumberRaw: "", dispatchCode: "3.1" })).toBe(false);
  });
});
