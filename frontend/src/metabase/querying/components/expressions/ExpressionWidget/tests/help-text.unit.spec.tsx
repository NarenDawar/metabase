jest.unmock("@uiw/react-codemirror");

import { act, fireEvent, screen, waitFor, within } from "__support__/ui";
import { checkNotNull } from "metabase/utils/types";

import {
  blurEditor,
  getEditorValue,
  getEditorView,
  pressKey,
  queryHelpText,
  setup,
  typeText,
  waitForCompletions,
  waitForValidationDebounce,
} from "./setup";

function queryHelpTextHeader() {
  return screen.queryByTestId("expression-helper-popover-structure");
}

async function clickHelpTextHeader() {
  fireEvent.mouseDown(
    screen.getByTestId("expression-helper-popover-structure"),
  );
}

// CodeMirror also renders its own (hidden) completion list, so look only at
// the suggestions the editor shows.
function queryCompletionOptions() {
  const suggestions = screen.queryByTestId(
    "custom-expression-editor-suggestions",
  );
  return suggestions ? within(suggestions).queryAllByRole("option") : [];
}

async function selectCompletion(label: string) {
  let option: HTMLElement | undefined;
  await waitFor(() => {
    option = queryCompletionOptions().find(
      (option) => option.textContent === label,
    );
    expect(option).toBeDefined();
  });
  fireEvent.mouseDown(checkNotNull(option));
}

async function assertSuggestionsAreVisible() {
  await waitFor(() => expect(queryCompletionOptions()).not.toHaveLength(0));
  expect(queryHelpText()).not.toBeInTheDocument();
}

async function assertHelpTextIsVisible() {
  expect(await screen.findByTestId("expression-helper")).toBeInTheDocument();
  expect(queryCompletionOptions()).toHaveLength(0);
  await waitForExample();
  // the example is formatted again on every render; let that settle
  await waitForValidationDebounce();
}

// the example is highlighted asynchronously
async function waitForExample() {
  await waitFor(() =>
    expect(screen.getByTestId("helptext-example")).not.toBeEmptyDOMElement(),
  );
}

function assertNeitherAreVisible() {
  expect(queryHelpText()).not.toBeInTheDocument();
  expect(queryCompletionOptions()).toHaveLength(0);
}

describe("ExpressionWidget > help text", () => {
  it("should show the help text of the function being typed", async () => {
    await setup();

    await typeText("lower()");
    await pressKey("ArrowLeft");

    expect(
      await screen.findByTestId("expression-helper-popover-structure"),
    ).toHaveTextContent("lower(value)");
    const helpText = screen.getByTestId("expression-helper");
    expect(
      within(helpText).getByText(
        "Returns the string of text in all lower case.",
      ),
    ).toBeInTheDocument();
    expect(
      within(helpText).getByText(
        "The column with values to convert to lower case.",
      ),
    ).toBeInTheDocument();
    // the example is highlighted asynchronously
    await waitFor(() =>
      expect(screen.getByTestId("helptext-example")).not.toBeEmptyDOMElement(),
    );
    await waitForValidationDebounce();
  });

  it("should not show the help text of a function the expression mode does not support", async () => {
    await setup({ expressionMode: "expression" });

    await typeText("Average([Price])");
    await pressKey("ArrowLeft", { times: 2 });
    await waitForValidationDebounce();

    expect(queryHelpText()).not.toBeInTheDocument();
  });

  it("should show the help text of the same function where the expression mode supports it", async () => {
    await setup({ expressionMode: "aggregation" });

    await typeText("Average([Price])");
    await pressKey("ArrowLeft", { times: 2 });

    expect(
      await screen.findByTestId("expression-helper-popover-structure"),
    ).toHaveTextContent("Average(column)");
  });

  it("should appear after a field reference and disappear outside the function", async () => {
    await setup();

    await typeText("lower([Category]");
    expect(
      await screen.findByTestId("expression-helper-popover-structure"),
    ).toHaveTextContent("lower(value)");

    await typeText(")");
    expect(getEditorValue()).toBe("lower([Category])");
    await waitFor(() => expect(queryHelpTextHeader()).not.toBeInTheDocument());
  });

  it("should not appear when the editor is not in focus (metabase#15891)", async () => {
    await setup();

    // accepting a function suggestion shows its help text
    await typeText("rou");
    await waitForCompletions();
    await pressKey("Enter");
    expect(await screen.findByTestId("expression-helper")).toHaveTextContent(
      "round([Temperature])",
    );

    await typeText("1.5");
    await pressKey("ArrowLeft");
    expect(screen.getByTestId("expression-helper")).toHaveTextContent(
      "round([Temperature])",
    );

    // blurring removes the help text
    await blurEditor();
    await waitFor(() => expect(queryHelpText()).not.toBeInTheDocument());

    await act(async () => getEditorView().focus());
    await pressKey("ArrowLeft");
    expect(await screen.findByTestId("expression-helper")).toHaveTextContent(
      "round([Temperature])",
    );

    // blurring again removes it again
    await blurEditor();
    await waitFor(() => expect(queryHelpText()).not.toBeInTheDocument());
  });

  describe("visibility", () => {
    async function setupRound() {
      await setup();
      await typeText("round");
      await waitForCompletions();
      await typeText("(");
      await waitForExample();
    }

    it("should be possible to show and hide the help text when there are no suggestions", async () => {
      await setupRound();
      await assertHelpTextIsVisible();

      await clickHelpTextHeader();
      assertNeitherAreVisible();

      await clickHelpTextHeader();
      await assertHelpTextIsVisible();
    });

    it("should show the help text again when the suggestions are closed", async () => {
      await setupRound();

      await typeText("[Rat");
      await assertSuggestionsAreVisible();

      // the help text reopens once a suggestion is picked
      await selectCompletion("Rating");
      await assertHelpTextIsVisible();
    });

    it("should be possible to close the help text", async () => {
      await setupRound();

      await clickHelpTextHeader();
      assertNeitherAreVisible();

      await typeText("[Rat");
      await assertSuggestionsAreVisible();

      // the help text stays hidden after selecting a suggestion
      await selectCompletion("Rating");
      await waitForValidationDebounce();
      assertNeitherAreVisible();
    });

    it("should be possible to prefer showing the help text over the suggestions", async () => {
      await setupRound();

      await typeText("[Rat");
      await assertSuggestionsAreVisible();

      await clickHelpTextHeader();
      await assertHelpTextIsVisible();

      // the help text stays shown after finishing typing
      await typeText("ing], ");
      await assertHelpTextIsVisible();
    });

    it("should be possible to prefer showing the suggestions when typing", async () => {
      await setupRound();

      await typeText("[Rat");
      await assertSuggestionsAreVisible();

      await clickHelpTextHeader();
      await assertHelpTextIsVisible();

      await clickHelpTextHeader();
      await assertSuggestionsAreVisible();

      // neither shows after finishing typing
      await typeText("ing], ");
      await waitForValidationDebounce();
      assertNeitherAreVisible();
    });
  });
});
