import { describe, expect, it } from "vitest";
import { computeLayout } from "yage/ui/layout/LayoutEngine";

describe("LayoutEngine stacks", () => {
  it("distributes main-axis fill width inside an HStack", () => {
    const result = computeLayout(
      {
        type: "HStack",
        width: 400,
        height: 40,
        spacing: 0,
        alignItems: "Center",
        children: [
          {
            type: "Input",
            id: "input",
            width: "fill",
            height: 40,
          },
          {
            type: "Button",
            id: "send",
            width: 90,
            height: 40,
            label: "Send",
          },
        ],
      },
      400,
      40
    );

    expect(result.children).toHaveLength(2);
    expect(result.children[0].node.id).toBe("input");
    expect(result.children[0].bounds.width).toBe(310);
    expect(result.children[0].bounds.x).toBe(0);
    expect(result.children[1].node.id).toBe("send");
    expect(result.children[1].bounds.width).toBe(90);
    expect(result.children[1].bounds.x).toBe(310);
  });
});
