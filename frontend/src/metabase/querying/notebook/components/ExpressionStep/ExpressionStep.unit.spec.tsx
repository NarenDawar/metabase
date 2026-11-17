import userEvent from "@testing-library/user-event";

import { createMockMetadata } from "__support__/metadata";
import { setupDatabaseEndpoints } from "__support__/server-mocks";
import {
  act,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "__support__/ui";
import * as Lib from "metabase-lib";
import {
  DEFAULT_TEST_QUERY,
  SAMPLE_PROVIDER,
  createMetadataProvider,
} from "metabase-lib/test-helpers";
import type { Database } from "metabase-types/api";
import { COMMON_DATABASE_FEATURES } from "metabase-types/api/mocks";
import {
  ORDERS_ID,
  createSampleDatabase,
} from "metabase-types/api/mocks/presets";

import { createMockNotebookStep } from "../../test-utils";

import { ExpressionStep } from "./ExpressionStep";

interface SetupOpts {
  query?: Lib.Query;
  database?: Database;
}

function setup({
  query = Lib.createTestQuery(SAMPLE_PROVIDER, DEFAULT_TEST_QUERY),
  database = createSampleDatabase(),
}: SetupOpts = {}) {
  const updateQuery = jest.fn();

  const step = createMockNotebookStep({
    type: "expression",
    query,
  });

  function getRecentQuery(): Lib.Query {
    expect(updateQuery).toHaveBeenCalledWith(expect.anything());
    const [recentQuery] = updateQuery.mock.lastCall;
    return recentQuery;
  }

  setupDatabaseEndpoints(database);

  renderWithProviders(
    <ExpressionStep
      step={step}
      // @ts-expect-error unit test
      color="#93A1AB"
      stageIndex={step.stageIndex}
      query={step.query}
      updateQuery={updateQuery}
      isLastOpened={false}
      reportTimezone="UTC"
    />,
  );

  return { getRecentQuery };
}

describe("Notebook Editor > Expression Step", () => {
  it("should handle adding expression", async () => {
    const { getRecentQuery } = setup();

    await userEvent.click(screen.getByRole("img", { name: "add icon" }));

    const input = await screen.findByTestId("custom-expression-query-editor");
    await userEvent.type(input, "1 + 1");
    await act(async () => {
      input.blur();
    });

    await userEvent.type(
      screen.getByTestId("expression-name"),
      "new expression{enter}",
    );

    const recentQuery = getRecentQuery();
    const expressions = Lib.expressions(recentQuery, 0);
    expect(expressions).toHaveLength(1);
    expect(Lib.displayInfo(recentQuery, 0, expressions[0]).displayName).toBe(
      "new expression",
    );
  });

  it("should handle updating existing expression", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [
        {
          source: {
            type: "table",
            id: ORDERS_ID,
          },
          expressions: [
            {
              name: "old name",
              value: {
                type: "operator",
                operator: "+",
                args: [
                  { type: "literal", value: 1 },
                  { type: "literal", value: 1 },
                ],
              },
            },
          ],
        },
      ],
    });
    const { getRecentQuery } = setup({ query });

    await userEvent.click(screen.getByText("old name"));

    const nameField = screen.getByTestId("expression-name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "new name{enter}");

    const recentQuery = getRecentQuery();
    const expressions = Lib.expressions(recentQuery, 0);
    expect(expressions).toHaveLength(1);
    expect(Lib.displayInfo(recentQuery, 0, expressions[0]).displayName).toBe(
      "new name",
    );
  });

  it("should handle removing existing expression", async () => {
    const query = Lib.createTestQuery(SAMPLE_PROVIDER, {
      stages: [
        {
          source: {
            type: "table",
            id: ORDERS_ID,
          },
          expressions: [
            {
              name: "expression name",
              value: {
                type: "operator",
                operator: "+",
                args: [
                  { type: "literal", value: 1 },
                  { type: "literal", value: 1 },
                ],
              },
            },
          ],
        },
      ],
    });
    const { getRecentQuery } = setup({ query });

    const expressionItem = screen.getByText("expression name");
    const closeIcon = within(expressionItem).getByRole("img", {
      name: "close icon",
    });

    await userEvent.click(closeIcon);

    expect(Lib.expressions(getRecentQuery(), 0)).toHaveLength(0);
  });

  it("should handle expressions named as existing columns (metabase#39508)", async () => {
    const { getRecentQuery } = setup();

    await userEvent.click(screen.getByRole("img", { name: "add icon" }));

    const input = await screen.findByTestId("custom-expression-query-editor");
    await userEvent.type(input, "1 + 1");
    await act(async () => {
      input.blur();
    });
    await userEvent.type(screen.getByTestId("expression-name"), "Total{enter}");

    const recentQuery = getRecentQuery();
    const expressions = Lib.expressions(recentQuery, 0);
    expect(expressions).toHaveLength(1);
    expect(Lib.displayInfo(recentQuery, 0, expressions[0]).displayName).toBe(
      "Total (1)",
    );
  });

  describe("closing the editor after a shortcut (metabase#63180)", () => {
    // the email extractions need regex lookaheads and lookbehinds, which the
    // H2 sample database supports
    const database = createSampleDatabase({
      features: [
        ...COMMON_DATABASE_FEATURES,
        "regex",
        "regex/lookaheads-and-lookbehinds",
      ],
    });
    const provider = createMetadataProvider({
      databaseId: database.id,
      metadata: createMockMetadata({ databases: [database] }),
    });

    function createQueryWithExpression() {
      return Lib.createTestQuery(provider, {
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
                    { type: "literal", value: 2 },
                  ],
                },
              },
            ],
          },
        ],
      });
    }

    async function expectClickOutsideToKeepEditor() {
      await userEvent.click(document.body);
      expect(screen.getByTestId("expression-editor")).toBeInTheDocument();
      expect(
        screen.queryByText("Keep editing your custom expression?"),
      ).not.toBeInTheDocument();
    }

    async function expectClickOutsideAfterClearingToCloseEditor() {
      await userEvent.clear(
        screen.getByTestId("custom-expression-query-editor"),
      );
      await userEvent.click(document.body);
      await waitFor(() =>
        expect(
          screen.queryByTestId("expression-editor"),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByText("Keep editing your custom expression?"),
      ).not.toBeInTheDocument();
    }

    it("should keep the editor open after combining columns until the expression is cleared", async () => {
      setup({ query: createQueryWithExpression(), database });

      await userEvent.click(screen.getByRole("img", { name: "add icon" }));
      await userEvent.click(await screen.findByText("Combine columns"));
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(
        await screen.findByTestId("custom-expression-query-editor"),
      ).toHaveValue('concat([Created At], " ", [Discount])');

      await expectClickOutsideToKeepEditor();
      await expectClickOutsideAfterClearingToCloseEditor();
    });

    it("should keep the editor open after extracting a column until the expression is cleared", async () => {
      setup({ query: createQueryWithExpression(), database });

      await userEvent.click(screen.getByRole("img", { name: "add icon" }));
      await userEvent.click(await screen.findByText("Extract columns"));
      await userEvent.click(await screen.findByText("User"));
      await userEvent.click(await screen.findByText("Email"));
      await userEvent.click(await screen.findByText("Domain"));
      expect(
        await screen.findByTestId("custom-expression-query-editor"),
      ).toHaveValue("domain([User → Email])");

      await expectClickOutsideToKeepEditor();
      await expectClickOutsideAfterClearingToCloseEditor();
    });
  });
});
