import { describe, expect, it } from "vitest";
import { parseLocalIntent } from "./intent";

describe("Appraise estimate assistant intent fallback", () => {
  it("routes the primary selected-row price command through the percentage tool", () => {
    expect(parseLocalIntent("Увеличь стоимость выбранных строк на 10%")).toMatchObject({
      percentage: 10,
      scope: "selected",
      undo: false,
    });
  });

  it("keeps decreases negative and extracts explicit positions", () => {
    expect(parseLocalIntent("Снизь цены на 7,5% в строках 1.2, 8.13")).toMatchObject({
      percentage: -7.5,
      scope: "positions",
      positions: ["1.2", "8.13"],
    });
  });

  it("recognizes receipt undo requests", () => {
    expect(parseLocalIntent("Отмени последнюю операцию").undo).toBe(true);
  });
});
