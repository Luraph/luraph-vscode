import { Luraph, type LuraphOptionList } from "luraph";
import * as vscode from "vscode";

const TIER_ICONS = {
  CUSTOMER_ONLY: undefined,
  PREMIUM_ONLY: new vscode.ThemeIcon("star"),
  ADMIN_ONLY: new vscode.ThemeIcon("lock"),
};

const TIER_TEXT = {
  CUSTOMER_ONLY: "",
  PREMIUM_ONLY: "Premium feature",
  ADMIN_ONLY: "Administrator-only feature",
};

export function activate(context: vscode.ExtensionContext) {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

  statusBarItem.name = "Luraph";
  statusBarItem.text = "$(terminal) Obfuscate with Luraph";
  statusBarItem.tooltip = new vscode.MarkdownString(
    `Obfuscate the currently opened file with [Luraph](https://lura.ph/ "Luraph - Online Lua Obfuscator").`
  );
  statusBarItem.command = "luraph.obfuscate";

  statusBarItem.show();

  const logOutput = vscode.window.createOutputChannel("Luraph", {
    log: true,
  });
  const log = logOutput.info;

  context.subscriptions.push(statusBarItem, logOutput); //auto dispose on extension deactivation

  log("Luraph VS Code extension has started.");

  const command = vscode.commands.registerCommand("luraph.obfuscate", async () => {
    const settings = vscode.workspace.getConfiguration("luraph");
    let apiKey: string | undefined = settings.get("API Key");

    if (!apiKey?.length) {
      const action = await vscode.window.showErrorMessage(
        "An API key must be configured to use the Luraph API.",
        {
          title: "Set API Key",
        }
      );

      if (!action) {
        return;
      }

      const input = await vscode.window.showInputBox({
        title: "Luraph - Set API Key",
        prompt: "Please enter your Luraph API key.",
        placeHolder: "Luraph API Key",

        ignoreFocusOut: true,
        validateInput: value => {
          if (!value.length) {
            return {
              message: "API key must not be empty.",
              severity: vscode.InputBoxValidationSeverity.Error,
            };
          }

          return null;
        },
      });

      if (!input) {
        return;
      }

      apiKey = input;
      settings.update("API Key", input, true); //update globally
    }

    const textEditor = vscode.window.activeTextEditor;
    const document = textEditor?.document;

    if (!document) {
      return vscode.window.showErrorMessage("Please open an file to obfuscate.");
    }

    const fileName = document.fileName;
    const contents = document.getText();

    if (!contents.length) {
      return vscode.window.showErrorMessage("Cannot obfuscate an empty file.");
    }

    log(`Performing Luraph obfuscation for ${fileName}...`);
    const luraphApi = new Luraph(apiKey);

    const availableNodes: vscode.QuickPickItem[] = [];

    try {
      // log("> Fetching nodes...");

      const nodesPromise = luraphApi.getNodes();

      vscode.window.withProgress(
        {
          title: "Fetching Luraph Nodes...",
          location: vscode.ProgressLocation.Notification,
          cancellable: true,
        },
        progress => nodesPromise
      );

      const nodes = await nodesPromise;

      const recommendedId = nodes.recommendedId;
      // log(`> Recommended node: ${recommendedId || "[none]"}`);

      // log("> Available nodes:");
      for (const [nodeId, nodeInfo] of Object.entries(nodes.nodes)) {
        const recommended = nodeId === recommendedId;
        const description = recommended ? " (recommended)" : undefined;
        const details = `${Math.floor(nodeInfo.cpuUsage)}% CPU usage, ${
          Object.keys(nodeInfo.options).length
        } options`;

        // log(`> - ${nodeId}: [${details}]${description ?? ""}`);

        const quickPickItem = {
          iconPath: recommended ? new vscode.ThemeIcon("heart") : undefined,
          label: nodeId,
          description: description,
          detail: details,
          picked: recommended,
        };

        if (recommended) {
          availableNodes.unshift(quickPickItem);
        } else {
          availableNodes.push(quickPickItem);
        }
      }

      const selectedNode = await vscode.window.showQuickPick(availableNodes, {
        title: "Luraph - Select Node",
        placeHolder: "Node ID",

        ignoreFocusOut: true,
      });

      if (!selectedNode) {
        return;
      }

      const nodeId = selectedNode.label;
      const nodeInfo = nodes.nodes[nodeId];

      // log(`> Selected node: ${nodeId}`);
      // log("> Available options:");

      const userOptionValues: LuraphOptionList = {};

      // @note topologically sort options
      let idOrder: string[];
      {
        /**
         * @note options that depend on each other
         */
        let linkedOptions: string[] = [];
        Object.entries(nodeInfo.options).forEach(([id, option]) => {
          if (option.dependencies) {
            linkedOptions.push(id);
            Object.keys(option.dependencies).forEach(id => linkedOptions.push(id));
          }
        });

        linkedOptions = linkedOptions
          // @note group dropdowns
          .sort((a, b) => (nodeInfo.options[a].type === "DROPDOWN" ? -1 : 0));

        const topologicalSort = (arr: string[]) => {
          const visited = new Map<string, boolean>();
          const result: string[] = [];

          const visit = (id: string) => {
            if (visited.get(id)) return;
            visited.set(id, true);

            const { dependencies } = nodeInfo.options[id];
            // @note put dependencies before dependent options
            if (dependencies) {
              Object.keys(dependencies).forEach(visit);
            }

            result.push(id);
          };

          arr.forEach(visit);

          return result;
        };

        linkedOptions = topologicalSort(linkedOptions);

        // @note put linked before
        idOrder = [
          ...linkedOptions,
          ...Object.keys(nodeInfo.options).sort(a =>
            nodeInfo.options[a].type === "CHECKBOX" ? -1 : 0
          ),
        ]
          // @note remove dupes
          .filter((v, i, arr) => arr.indexOf(v) === i);

        log(
          JSON.stringify(
            idOrder.map(id => `${id} : ${nodeInfo.options[id].type}`),
            null,
            4
          )
        );
      }

      for (let i = 0; i < idOrder.length; ) {
        let optionId = idOrder[i];
        let { name, description, tier, type, choices, dependencies } = nodeInfo.options[optionId];

        let tierIcon = TIER_ICONS[tier];
        let tierText = TIER_TEXT[tier];
        let tierTextParen = tierText ? ` (${tierText})` : "";

        // log(`> - [${optionId}] ${name}${tierTextParen} - ${description} (${type})`);

        switch (type) {
          case "CHECKBOX": {
            type TCheckbox = vscode.QuickPickItem & { id: string };
            let checkboxCluster: TCheckbox[] = [];

            while (true) {
              userOptionValues[optionId] = false;

              // @note put options with dependencies at the end
              checkboxCluster.push({
                id: optionId,
                label: name,
                description: optionId + tierTextParen,
                detail: description,
                iconPath: tierIcon,
              });

              i += 1;

              optionId = idOrder[i];

              if (nodeInfo.options[optionId]?.type !== "CHECKBOX") break;

              ({ name, description, tier, type, choices, dependencies } =
                nodeInfo.options[optionId]);

              tierIcon = TIER_ICONS[tier];
              tierText = TIER_TEXT[tier];
              tierTextParen = tierText ? ` (${tierText})` : "";
            }

            const selectedValues = await new Promise<readonly TCheckbox[] | undefined>(resolve => {
              const disposables: vscode.Disposable[] = [];

              const dispose = () => {
                disposables.forEach(d => d.dispose());
              };

              const optionsPick = vscode.window.createQuickPick<(typeof checkboxCluster)[number]>();
              disposables.push(optionsPick);

              // @note initial visible items
              const getVisibleOptions = () =>
                checkboxCluster.filter(({ id }) => {
                  let option = nodeInfo.options[id];

                  if (!option.dependencies) return true;

                  for (let [depId, depVals] of Object.entries(option.dependencies)) {
                    if (
                      // @note check previously selected options
                      !depVals.includes(userOptionValues[depId]) &&
                      // @note check current selected cluster dependencies
                      !depVals.includes(!!optionsPick.selectedItems.find(i => i.id === depId))
                    ) {
                      return false;
                    }
                  }

                  return true;
                });

              optionsPick.title = "Luraph - Select Options (checkbox)";
              optionsPick.placeholder = "Option name/ID";

              optionsPick.items = getVisibleOptions();

              optionsPick.ignoreFocusOut = true;
              optionsPick.canSelectMany = true;
              optionsPick.matchOnDescription = true;

              /**
               * @note onDidChangeSelection is also triggered when you edit `.selectedItems` property, which gets reset when changing `.items` for some reason, so we need to reapply selected items without creating infinite loop, where event is triggered inside its handler
               */
              let ignoreSelectionUpdate = false;

              disposables.push(
                optionsPick.onDidAccept(() => {
                  // @note call resolve first so items are not empty
                  resolve(optionsPick.selectedItems);
                  dispose();
                }),

                optionsPick.onDidChangeSelection(items => {
                  // log(
                  //   `onDidChangeSelection ${JSON.stringify(items.map(i => i.id))} / ${JSON.stringify(
                  //     optionsPick.selectedItems.map(i => i.id)
                  //   )} :: ignored: ${ignoreSelectionUpdate}`
                  // );

                  if (ignoreSelectionUpdate) {
                    ignoreSelectionUpdate = false;
                    return;
                  }

                  const visibleOptions = getVisibleOptions();
                  // @note if different set of options, then update, tbh we could remove this check and update every time
                  if (!visibleOptions.every((o, i) => o.id === optionsPick.items[i].id)) {
                    optionsPick.items = visibleOptions;
                    optionsPick.selectedItems = items;
                    ignoreSelectionUpdate = true;
                  }
                }),

                optionsPick.onDidHide(() => {
                  resolve(undefined);
                  dispose();
                })
              );

              optionsPick.show();
            });

            // log(
            //   `selectedValues: ${
            //     selectedValues &&
            //     JSON.stringify(
            //       selectedValues.map(i => i.id),
            //       null,
            //       4
            //     )
            //   }`
            // );

            if (!selectedValues) {
              return;
            }

            for (const checkboxInfo of selectedValues) {
              userOptionValues[checkboxInfo.id] = true;
            }

            break;
          }
          case "DROPDOWN": {
            userOptionValues[optionId] = choices[0];

            // log(`    Choices: [${choices.join(", ")}]`);

            const selectedValue = await vscode.window.showQuickPick(
              choices.map((choice, index) => ({
                label: choice,
                description: tierText,
                iconPath: index !== 0 ? tierIcon : undefined,
                picked: index === 0,
              })) as vscode.QuickPickItem[],
              {
                title: `Luraph - Select Option: ${name}${tierTextParen} - ${description} [${optionId}]`,
                placeHolder: `Value for ${name}`,

                ignoreFocusOut: true,
                canPickMany: false,
                matchOnDetail: true,
              }
            );

            if (!selectedValue) {
              return;
            }

            userOptionValues[optionId] = selectedValue.label;

            i += 1;

            break;
          }
          case "TEXT": {
            userOptionValues[optionId] = "";

            const selectedValue = await vscode.window.showInputBox({
              title: `Luraph - Select Option: ${name}${tierTextParen} [${optionId}]`,
              prompt: description,
              placeHolder: `Value for ${name} (leave empty to use default value)`,

              ignoreFocusOut: true,
            });

            if (!selectedValue) {
              return;
            }

            userOptionValues[optionId] = selectedValue;

            i += 1;

            break;
          }
          default:
            throw new Error(`Received invalid option type: ${type}`);
        }
      }

      const confirm = await vscode.window.showInformationMessage(
        "Confirm options",
        {
          modal: true,
          detail: Object.entries(userOptionValues)
            .map(
              ([id, val]) =>
                `${nodeInfo.options[id].name}: ${
                  typeof val === "boolean" ? (val ? "✅" : "❌") : val
                }`
            )
            .join("\n"),
        },
        "Obfuscate"
      );

      if (confirm !== "Obfuscate") return;

      statusBarItem.text = "$(gear~spin) Obfuscating...";
      const { jobId } = await luraphApi.createNewJob(
        nodeId,
        contents,
        `[luraph-vscode] ${fileName}`,
        userOptionValues
      );

      log(`> Job ID: ${jobId}`);
      statusBarItem.text = `$(gear~spin) Obfuscating... (Job ID: ${jobId})`;

      const status = await luraphApi.getJobStatus(jobId);
      if (!status.success) {
        const error = status.error;
        log(`> Obfuscation failed: ${error}`);
        return vscode.window.showErrorMessage(`Obfuscation Error: ${error}`);
      }

      const result = await luraphApi.downloadResult(jobId);
      log(`> Obfuscation succeeded! (${result.data.length} bytes)`);

      // @note so workspaceFolders is null if we open file directly, but it may also be empty array if workspace is created but still no folders added/open bruh.
      // @note til: we may have only one ?. for entire chain and it won't throw but properly return undefined 
      let directory = vscode.workspace.workspaceFolders?.[0]?.uri.path || "";
      let resultName = document.uri.path;
      if (document.uri.scheme === "file" || document.uri.scheme === "untitled") {
        const lastSlash = resultName.lastIndexOf("/");

        if (lastSlash !== -1) {
          directory = resultName.substring(0, lastSlash);
          resultName = resultName.substring(lastSlash + 1);
        }
      }

      const filePart = resultName.split(".")[0];
      resultName = `${filePart}-obfuscated.lua`;

      let resultUri;
      let tries = 0;
      while (true) {
        resultUri = vscode.Uri.from({
          path: `${directory}/${filePart}-obfuscated${tries > 0 ? `-${tries}` : ""}.lua`,
          scheme: "untitled",
        });

        try {
          await vscode.workspace.fs.stat(resultUri.with({ scheme: "file" }));
        } catch (err) {
          if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
            break; //file doesn't exist, save here
          }

          throw err;
        }

        tries++;
      }

      log(`> Saving to file: ${resultUri.fsPath}`);

      const newDoc = await vscode.workspace.openTextDocument(resultUri);
      const textEditor = await vscode.window.showTextDocument(newDoc);

      const editsApplied = await textEditor.edit(editBuilder => {
        const fullRange = new vscode.Range(
          newDoc.lineAt(0).range.start,
          newDoc.lineAt(newDoc.lineCount - 1).range.end
        );

        editBuilder.replace(fullRange, result.data);
      });

      if (!editsApplied) {
        throw new Error("VS Code Extension Error: Could not apply edits to created TextEditor");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "LuraphException") {
        //TODO: use instanceof LuraphException
        return vscode.window.showErrorMessage(`Luraph API Error: ${err.message}`);
      }

      throw err;
    } finally {
      statusBarItem.text = "$(terminal) Obfuscate with Luraph";
    }
  });

  context.subscriptions.push(command);
}

export function deactivate() {} //no-op
