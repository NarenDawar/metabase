jest.unmock("@uiw/react-codemirror");

import userEvent from "@testing-library/user-event";

import { act, fireEvent, screen, waitFor, within } from "__support__/ui";
import { checkNotNull } from "metabase/utils/types";
import * as Lib from "metabase-lib";
import { SAMPLE_PROVIDER } from "metabase-lib/test-helpers";
import { COMMON_DATABASE_FEATURES } from "metabase-types/api/mocks";
import {
  ORDERS_ID,
  PEOPLE_ID,
  PRODUCTS_ID,
  REVIEWS_ID,
  createSampleDatabase,
} from "metabase-types/api/mocks/presets";

import {
  blurEditor,
  getCompletionLabels,
  getEditorValue,
  getEditorView,
  getSelectedCompletionLabel,
  pasteText,
  pressKey,
  selectRange,
  setCursorPosition,
  setup,
  typeText,
  waitForCompletions,
  waitForValidationDebounce,
} from "./setup";

function createOrdersQuery() {
  return Lib.createTestQuery(SAMPLE_PROVIDER, {
    stages: [{ source: { type: "table", id: ORDERS_ID } }],
  });
}

describe("ExpressionWidget > completion", () => {
  it("should suggest columns but not arithmetic operators", async () => {
    await setup();

    await typeText("[Pri");
    expect(await waitForCompletions()).toContain("Price");

    await typeText("ce] ");
    expect(getEditorValue()).toBe("[Price] ");
    await waitFor(() =>
      expect(
        getCompletionLabels().filter((label) => /^\s*[-+*/](\s|$)/.test(label)),
      ).toEqual([]),
    );
  });

  it("should insert a function template when accepting a function suggestion", async () => {
    await setup();

    await typeText("bet");
    await waitForCompletions();
    await pressKey("Enter");
    expect(getEditorValue()).toBe("between(column, start, end)");
  });

  it("should insert a function without arguments with empty parentheses", async () => {
    await setup();

    await typeText("now");
    await waitForCompletions();
    await pressKey("Enter");
    expect(getEditorValue()).toBe("now()");
  });

  it("should not show suggestions once the editor loses focus (metabase#31643)", async () => {
    await setup({ expressionMode: "aggregation" });

    await typeText("Count");
    expect(await waitForCompletions()).toContain("Count");
    await pressKey("Enter");
    await blurEditor();

    await waitFor(() =>
      expect(
        screen.queryByTestId("custom-expression-editor-suggestions"),
      ).not.toBeInTheDocument(),
    );
  });

  it("should not show an error while a snippet is still active", async () => {
    await setup();

    await typeText("conca");
    await waitForCompletions();
    await pressKey("Tab");
    expect(getEditorValue()).toBe("concat(value1, value2)");

    await waitForValidationDebounce();
    expect(screen.queryByText(/Unknown column/)).not.toBeInTheDocument();

    await pressKey("Tab");
    expect(await screen.findByText(/Unknown column/)).toBeInTheDocument();
  });

  it("should suggest a custom column that renames another custom column", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [
        {
          source: { type: "table", id: ORDERS_ID },
          expressions: [
            {
              name: "Foo",
              value: {
                type: "operator",
                operator: "+",
                args: [
                  { type: "literal", value: 1 },
                  { type: "literal", value: 1 },
                ],
              },
            },
            { name: "Bar", value: { type: "column", name: "Foo" } },
          ],
        },
      ],
    });
    await setup({ query });

    await typeText("[Ba");
    expect(await waitForCompletions()).toContain("Bar");
  });

  it("should suggest an aggregation that renames another aggregation", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [
        {
          source: { type: "table", id: ORDERS_ID },
          aggregations: [
            {
              name: "Foo",
              value: {
                type: "operator",
                operator: "sum",
                args: [{ type: "column", name: "TOTAL" }],
              },
            },
            { name: "Bar", value: { type: "column", name: "Foo" } },
          ],
        },
      ],
    });
    await setup({ query, expressionMode: "aggregation" });

    await typeText("[Ba");
    expect(await waitForCompletions()).toContain("Bar");
  });

  it("should suggest non-numeric columns inside Distinct (metabase#13469)", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [{ source: { type: "table", id: REVIEWS_ID } }],
    });
    await setup({ query, expressionMode: "aggregation" });

    await typeText("Distinct([R");
    expect(await waitForCompletions()).toContain("Reviewer");
  });

  it("should not eat up the following characters when applying a suggestion (metabase#49882)", async () => {
    await setup({ query: createOrdersQuery() });

    await pasteText('case([Total] > 200, , "X")');
    await setCursorPosition("case([Total] > 200, ".length);
    await typeText("[tot");
    await waitForCompletions();
    await pressKey("Enter");

    expect(getEditorValue()).toBe('case([Total] > 200, [Total], "X")');
    expect(
      screen.queryByText("Expecting a closing parenthesis"),
    ).not.toBeInTheDocument();
  });

  it("should update the selected suggestion when the suggestion list changes (metabase#49882)", async () => {
    await setup({ query: createOrdersQuery() });

    await typeText("[Produ");
    await waitForCompletions();
    await pressKey("ArrowDown", { times: 5 });
    await waitFor(() =>
      expect(getSelectedCompletionLabel()).toBe("Product → Rating"),
    );
    expect(await pressKey("Tab")).toBe(false);

    expect(getEditorValue()).toBe("[Product → Rating]");
    expect(screen.getByTestId("expression-name")).not.toHaveFocus();
  });

  it("should keep the characters after an unclosed identifier when applying a suggestion (metabase#50925)", async () => {
    const source = "case([ID] = 1, [Price] * 1.21, [Price])";
    await setup();

    await pasteText(source);
    await setCursorPosition(source.length - "[Price])".length);
    await typeText(" [Pr");
    await waitForCompletions();
    await pressKey("Enter");
    expect(getEditorValue()).toBe(
      "case([ID] = 1, [Price] * 1.21,  [Price][Price])",
    );
  });

  it("should keep the whitespace after an unclosed identifier when applying a suggestion (metabase#50925)", async () => {
    const source = "case([ID] = 1, [Price] * 1.21, [Price])";
    await setup();

    await pasteText(source);
    await setCursorPosition(source.length - " [Price])".length);
    await typeText(" [Pr");
    await waitForCompletions();
    await pressKey("Enter");
    expect(getEditorValue()).toBe(
      "case([ID] = 1, [Price] * 1.21, [Price] [Price])",
    );
  });
});

describe("ExpressionWidget > keyboard", () => {
  it("should not leave the editor with the Tab key", async () => {
    await setup({ query: createOrdersQuery() });

    await typeText("[Tot");
    await waitForCompletions();
    await pressKey("Enter");
    expect(getEditorValue()).toBe("[Total]");

    // CodeMirror prevents the default action, so focus stays in the editor
    expect(await pressKey("Tab")).toBe(false);
    expect(getEditorValue()).toBe("[Total]  ");
    expect(screen.getByTestId("expression-name")).not.toHaveFocus();
  });
});

describe("ExpressionWidget > validation", () => {
  it("should accept a custom column named like an aggregation in a later stage (metabase#21513)", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [
        {
          source: { type: "table", id: PRODUCTS_ID },
          aggregations: [{ type: "operator", operator: "count", args: [] }],
          breakouts: [{ type: "column", name: "CATEGORY" }],
        },
        {},
      ],
    });
    const { onChangeClause } = await setup({ query, stageIndex: 1 });

    await typeText("[Count] * 2");
    await typeName("Double Count");
    const doneButton = screen.getByRole("button", { name: "Done" });
    await waitFor(() => expect(doneButton).toBeEnabled());
    expect(onChangeClause).not.toHaveBeenCalled();
  });

  it("should keep an expression that a paste makes invalid and show the error (metabase#49882, metabase#15892)", async () => {
    const source =
      'case([Tax] > 1, case([Total] > 200, [Total], "Nothing"), [Tax])';
    await setup({ query: createOrdersQuery() });

    await pasteText(source);
    // cut the last `[Tax]`
    const taxStart = source.lastIndexOf("[Tax]");
    await selectRange(taxStart, taxStart + "[Tax]".length);
    await pasteText("");
    // and paste it before the inner `case`
    await setCursorPosition("case([Tax] > 1,".length);
    await pasteText("[Tax]");

    expect(getEditorValue()).toBe(
      'case([Tax] > 1,[Tax] case([Total] > 200, [Total], "Nothing"), )',
    );
    expect(
      await screen.findByText("Expecting operator but got case instead"),
    ).toBeInTheDocument();
    expect(getEditorValue()).toBe(
      'case([Tax] > 1,[Tax] case([Total] > 200, [Total], "Nothing"), )',
    );
  });

  it("should show an error for a multi-argument function with too few arguments and survive a name edit (metabase#53682)", async () => {
    await setup();

    await pasteText("contains([Category])");
    await blurEditor();
    expect(
      await screen.findByText("Function contains expects at least 2 arguments"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

    await typeName("Name");
    expect(screen.getByTestId("expression-editor")).toBeInTheDocument();
    expect(screen.getByTestId("expression-name")).toHaveValue("Name");
    expect(
      screen.getByText("Function contains expects at least 2 arguments"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });
});

async function typeName(name: string) {
  await userEvent.type(screen.getByTestId("expression-name"), name);
}

describe("ExpressionWidget > editor", () => {
  it("should not erase the formula and the name on cursor moves or window resize (metabase#15734, metabase#16127)", async () => {
    await setup({ query: createOrdersQuery() });
    // written without spaces on purpose
    await typeText("1+1");
    await typeName("Math");
    const doneButton = screen.getByRole("button", { name: "Done" });
    await waitFor(() => expect(doneButton).toBeEnabled());

    // jsdom has no layout for Home and End, so move to the ends directly
    await act(async () => getEditorView().focus());
    await setCursorPosition(getEditorValue().length);
    await pressKey("ArrowLeft");
    await setCursorPosition(0);
    await pressKey("ArrowRight", { times: 2 });
    expect(getEditorView().state.selection.main.head).toBe(2);
    await act(async () => screen.getByTestId("expression-name").focus());
    await waitForValidationDebounce();
    expect(doneButton).toBeEnabled();
    expect(getEditorValue()).toBe("1+1");

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("expression-name")).toHaveValue("Math");
    expect(getEditorValue()).toBe("1+1");
    expect(doneButton).toBeEnabled();
  });

  it("should not erase the formula and the name when the expression is incomplete (metabase#16126)", async () => {
    await setup({ query: createOrdersQuery() });
    await typeText("1+1");
    await typeName("Math");
    const doneButton = screen.getByRole("button", { name: "Done" });
    await waitFor(() => expect(doneButton).toBeEnabled());

    await act(async () => getEditorView().focus());
    await setCursorPosition(getEditorValue().length);
    await pressKey("Backspace");
    await blurEditor();

    expect(await screen.findByText("Expected expression")).toBeInTheDocument();
    expect(doneButton).toBeDisabled();
    expect(getEditorValue()).toBe("1+");
    expect(screen.getByTestId("expression-name")).toHaveValue("Math");
  });
});

describe("ExpressionWidget > functions the database supports", () => {
  it.each([
    {
      title: "convertTimezone without the optional source timezone",
      tableId: ORDERS_ID,
      formula: 'convertTimezone([Created At], "Asia/Ho_Chi_Minh")',
      feature: "convert-timezone" as const,
    },
    {
      title: "splitPart with a positive index",
      tableId: PEOPLE_ID,
      formula: "splitPart([Name], ' ', 1)",
      feature: "split-part" as const,
    },
    {
      title: "today",
      tableId: PRODUCTS_ID,
      formula: "today()",
      feature: "expressions/today" as const,
    },
  ])(
    "should accept $title when the database supports it",
    async ({ tableId, formula, feature }) => {
      const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
        stages: [{ source: { type: "table", id: tableId } }],
      });
      const database = createSampleDatabase({
        engine: "postgres",
        features: [...COMMON_DATABASE_FEATURES, feature],
      });
      await setup({ query, database });

      await pasteText(formula);
      await blurEditor();
      await typeName("Name");
      const doneButton = screen.getByRole("button", { name: "Done" });
      await waitFor(() => expect(doneButton).toBeEnabled());
    },
  );

  it("should reject a splitPart index below 1", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [{ source: { type: "table", id: PEOPLE_ID } }],
    });
    const database = createSampleDatabase({
      engine: "postgres",
      features: [...COMMON_DATABASE_FEATURES, "split-part"],
    });
    await setup({ query, database });

    await pasteText("splitPart([Name], ' ', 0)");
    await blurEditor();
    await typeName("Split Title");

    expect(
      await screen.findByText("Expected positive integer but found 0"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });
});

describe("ExpressionWidget > custom aggregations", () => {
  function createQueryWithCustomSum() {
    return Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [
        {
          source: { type: "table", id: ORDERS_ID },
          aggregations: [
            {
              name: "Custom Sum",
              value: {
                type: "operator",
                operator: "sum",
                args: [{ type: "column", name: "TOTAL" }],
              },
            },
          ],
        },
      ],
    });
  }

  async function selectCompletion(label: string) {
    await waitForCompletions();
    const suggestions = screen.getByTestId(
      "custom-expression-editor-suggestions",
    );
    const option = checkNotNull(
      within(suggestions)
        .getAllByRole("option")
        .find((option) => option.textContent === label),
    );
    fireEvent.mouseDown(option);
  }

  async function formatExpression() {
    await userEvent.click(
      await screen.findByRole("button", { name: "Auto-format" }),
    );
  }

  /** The column a clause references on its own, e.g. `[Custom Sum]`. */
  function getReferencedColumnInfo(
    query: Lib.Query,
    stageIndex: number,
    clause: Lib.AggregationClause | Lib.ExpressionClause,
  ) {
    const parts = Lib.expressionParts(query, stageIndex, clause);
    if (!Lib.isColumnMetadata(parts)) {
      throw new Error("The clause does not reference a column on its own");
    }
    return Lib.displayInfo(query, stageIndex, parts);
  }

  it("should be possible to resolve aggregations from the question directly", async () => {
    const query = createQueryWithCustomSum();
    const { onChangeClause } = await setup({
      query,
      expressionMode: "aggregation",
    });

    await typeText("[Custom");
    await selectCompletion("Custom Sum");
    expect(getEditorValue()).toBe("[Custom Sum]");

    // keep typing after picking the completion
    await typeText("+ 1");
    await formatExpression();
    await waitFor(() => expect(getEditorValue()).toBe("[Custom Sum] + 1"));
    await typeName("Derived");
    const doneButton = screen.getByRole("button", { name: "Done" });
    await waitFor(() => expect(doneButton).toBeEnabled());

    // reference the aggregation on its own
    await act(async () => getEditorView().focus());
    await setCursorPosition(getEditorValue().length);
    await pressKey("Backspace", { times: 4 });
    expect(getEditorValue()).toBe("[Custom Sum]");
    await formatExpression();
    await waitFor(() => expect(doneButton).toBeEnabled());
    await userEvent.click(doneButton);

    expect(onChangeClause).toHaveBeenCalledTimes(1);
    const [name, clause] = onChangeClause.mock.calls[0];
    expect(name).toBe("Derived");
    const nextQuery = Lib.aggregate(query, -1, clause);
    const [, derived] = Lib.aggregations(nextQuery, -1);
    expect(getReferencedColumnInfo(nextQuery, -1, derived)).toMatchObject({
      name: "Custom Sum",
      isAggregation: true,
    });
  });

  it("should be possible to resolve aggregations from the previous stage", async () => {
    const query = Lib.appendStage(createQueryWithCustomSum());
    const { onChangeClause } = await setup({ query, stageIndex: 1 });

    await typeText("[Custom S");
    await selectCompletion("Custom Sum");
    expect(getEditorValue()).toBe("[Custom Sum]");
    await formatExpression();
    await typeName("Derived");
    const doneButton = screen.getByRole("button", { name: "Done" });
    await waitFor(() => expect(doneButton).toBeEnabled());
    await userEvent.click(doneButton);

    expect(onChangeClause).toHaveBeenCalledTimes(1);
    const [name, clause] = onChangeClause.mock.calls[0];
    expect(name).toBe("Derived");
    expect(getReferencedColumnInfo(query, 1, clause)).toMatchObject({
      name: "Custom Sum",
      isFromPreviousStage: true,
    });
  });

  it("should not be possible to create cycles in custom aggregations", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [
        {
          source: { type: "table", id: ORDERS_ID },
          aggregations: [
            {
              name: "Custom Sum",
              value: {
                type: "operator",
                operator: "sum",
                args: [{ type: "column", name: "TOTAL" }],
              },
            },
            {
              name: "Custom Sum 2",
              value: {
                type: "operator",
                operator: "+",
                args: [
                  { type: "column", name: "Custom Sum" },
                  { type: "literal", value: 1 },
                ],
              },
            },
          ],
        },
      ],
    });
    const [customSum] = Lib.aggregations(query, -1);
    await setup({
      query,
      expressionMode: "aggregation",
      expressionIndex: 0,
      clause: customSum,
      name: "Custom Sum",
    });
    await waitFor(() => expect(getEditorValue()).toBe("Sum([Total])"));

    await selectRange(0, getEditorValue().length);
    await pasteText("[Custom Sum 2]");

    expect(
      await screen.findByText(
        "Cycle detected: Custom Sum → Custom Sum 2 → Custom Sum",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
  });

  it("should show a custom error when there are no aggregations in a custom aggregation", async () => {
    await setup({ query: createOrdersQuery(), expressionMode: "aggregation" });

    await typeText("1 + 1");

    expect(
      await screen.findByText(
        "Aggregations should contain at least one aggregation function.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });

  it("should allow using aggregation functions inside expressions in aggregation (metabase#52611)", async () => {
    const { onChangeClause } = await setup({
      query: createOrdersQuery(),
      expressionMode: "aggregation",
    });

    await pasteText("case(Sum([Total]) > 10, Sum([Total]), Sum([Subtotal]))");
    await blurEditor();
    await typeName("conditional sum");
    const doneButton = screen.getByRole("button", { name: "Done" });
    await waitFor(() => expect(doneButton).toBeEnabled());
    await userEvent.click(doneButton);

    expect(onChangeClause).toHaveBeenCalledWith(
      "conditional sum",
      expect.anything(),
    );
  });
});
