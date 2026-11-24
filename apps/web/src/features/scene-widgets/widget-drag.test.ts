import { describe, expect, it } from "vitest";
import { previewDragLayout, shouldPersistWidgetDrag } from "./widget-drag";

describe("widget drag persistence", () => {
  it("only commits the layout when the pointer is released", () => {
    expect(shouldPersistWidgetDrag("move")).toBe(false);
    expect(shouldPersistWidgetDrag("cancel")).toBe(false);
    expect(shouldPersistWidgetDrag("up")).toBe(true);

    const layout = {
      schemaVersion: "1.0.0" as const,
      widgets: [
        { id: "a", type: "metric-card", x: 4, y: 16, w: 20, h: 16 },
        { id: "b", type: "summary-card", x: 78, y: 16, w: 20, h: 16 },
      ],
    };
    const preview = previewDragLayout(layout, "a", { x: 6, y: 18, w: 20, h: 16 });
    expect(preview.widgets[0]?.x).toBe(6);
    expect(layout.widgets[0]?.x).toBe(4);
    expect(preview.widgets[1]?.x).toBe(78);
  });
});
