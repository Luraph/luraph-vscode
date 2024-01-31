import { Luraph, type LuraphOptionList } from "luraph";
import * as vscode from "vscode";

const TIER_ICONS = {
	CUSTOMER_ONLY: undefined,
	PREMIUM_ONLY: new vscode.ThemeIcon("star"),
	ADMIN_ONLY: new vscode.ThemeIcon("lock")
};

const TIER_TEXT = {
	CUSTOMER_ONLY: "",
	PREMIUM_ONLY: "Premium feature",
	ADMIN_ONLY: "Administrator-only feature"
}

export function activate(context: vscode.ExtensionContext) {
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

	statusBarItem.name = "Luraph";
	statusBarItem.text = "$(terminal) Obfuscate with Luraph";
	statusBarItem.tooltip = new vscode.MarkdownString(`Obfuscate the currently opened file with [Luraph](https://lura.ph/ "Luraph - Online Lua Obfuscator").`);
	statusBarItem.command = "luraph.obfuscate";

	statusBarItem.show();

	const logOutput = vscode.window.createOutputChannel("Luraph", {
		log: true
	});
	const log = (msg: string) => logOutput.info(msg);

	context.subscriptions.push(statusBarItem, logOutput); //auto dispose on extension deactivation

	log("Luraph VS Code extension has started.");

	const command = vscode.commands.registerCommand('luraph.obfuscate', async () => {
		const settings = vscode.workspace.getConfiguration("luraph");
		let apiKey: string | undefined = settings.get("API Key");

		if(!apiKey?.length){
			const action = await vscode.window.showErrorMessage("An API key must be configured to use the Luraph API.",
				{
					title: "Set API Key"
				}
			);

			if(!action){
				return;
			}

			const input = await vscode.window.showInputBox({
				title: "Luraph - Set API Key",
				prompt: "Please enter your Luraph API key.",
				placeHolder: "Luraph API Key",

				ignoreFocusOut: true,
				validateInput: (value) => {
					if(!value.length){
						return {
							message: "API key must not be empty.",
							severity: vscode.InputBoxValidationSeverity.Error
						};
					}

					return null;
				}
			});

			if(!input){
				return;
			}

			apiKey = input;
			settings.update("API Key", input, true); //update globally
		}

		const textEditor = vscode.window.activeTextEditor;
		const document = textEditor?.document;

		if(!document){
			return vscode.window.showErrorMessage("Please open an file to obfuscate.");
		}

		const fileName = document.fileName;
		const contents = document.getText();

		if(!contents.length){
			return vscode.window.showErrorMessage("Cannot obfuscate an empty file.");
		}

		log(`Performing Luraph obfuscation for ${fileName}...`);
		const luraphApi = new Luraph(apiKey);

		const availableNodes: vscode.QuickPickItem[] = [];

		try{
			log("> Fetching nodes...");
			const nodes = await luraphApi.getNodes();

			const recommendedId = nodes.recommendedId;
			log(`> Recommended node: ${recommendedId || "[none]"}`);
			
			log("> Available nodes:");
			for(const [nodeId, nodeInfo] of Object.entries(nodes.nodes)){
				const recommended = nodeId === recommendedId;
				const description = (recommended ? " (recommended)" : undefined);
				const details = `${Math.floor(nodeInfo.cpuUsage)}% CPU usage, ${Object.keys(nodeInfo.options).length} options`;

				log(`> - ${nodeId}: [${details}]${description ?? ""}`);

				const quickPickItem = {
					iconPath: recommended ? new vscode.ThemeIcon("heart") : undefined,
					label: nodeId,
					description: description,
					detail: details,
					picked: recommended
				};

				if(recommended){
					availableNodes.unshift(quickPickItem);
				}else{
					availableNodes.push(quickPickItem);
				}
			}

			const selectedNode = await vscode.window.showQuickPick(availableNodes, {
				title: "Luraph - Select Node",
				placeHolder: "Node ID",

				ignoreFocusOut: true
			});

			if(!selectedNode){
				return;
			}

			const nodeId = selectedNode.label;
			const nodeInfo = nodes.nodes[nodeId];

			log(`> Selected node: ${nodeId}`);
			log("> Available options:");

			const optionValues: LuraphOptionList = {};
			const checkboxes: (vscode.QuickPickItem & {id: string})[] = [];
			const dropdowns = [];
			const textFields = [];

			for(const [optionId, { name, description, tier, type, choices }] of Object.entries(nodeInfo.options)){
				const tierIcon = TIER_ICONS[tier];
				const tierText = TIER_TEXT[tier];
				const tierTextParen = tierText ? ` (${tierText})` : "";

				log(`> - [${optionId}] ${name}${tierTextParen} - ${description} (${type})`);

				switch(type){
					case "CHECKBOX": {
						optionValues[optionId] = false;

						checkboxes.push({
							id: optionId,
							label: name,
							description: optionId + tierTextParen,
							detail: description,
							iconPath: tierIcon
						});
						break;
					}
					case "DROPDOWN": {
						optionValues[optionId] = choices[0];

						log(`    Choices: [${choices.join(", ")}]`);

						dropdowns.push({
							id: optionId,
							title: `${name}${tierTextParen} - ${description} [${optionId}]`,
							placeHolder: `Value for ${name}`,
							items: choices.map((choice, index) => ({
								label: choice,
								description: tierText,
								iconPath: index !== 0 ? tierIcon : undefined,
								picked: index === 0
							})) as vscode.QuickPickItem[]
						});
						break;
					}
					case "TEXT": {
						optionValues[optionId] = "";

						textFields.push({
							id: optionId,
							title: `${name}${tierTextParen} [${optionId}]`,
							prompt: description,
							placeHolder: `Value for ${name} (leave empty to use default value)`,
						})
						break;
					}
					default:
						throw new Error(`Received invalid option type: ${type}`);
				}
			}

			const selectedValues = await vscode.window.showQuickPick(checkboxes, {
				title: "Luraph - Select Options (checkbox)",
				placeHolder: "Option name/ID",

				ignoreFocusOut: true,
				canPickMany: true,
				matchOnDescription: true
			});

			if(!selectedValues){
				return;
			}

			for(const checkboxInfo of selectedValues){
				optionValues[checkboxInfo.id] = true;
			}
			
			for(const { id, title, placeHolder, items } of dropdowns){
				const selectedValue = await vscode.window.showQuickPick(items, {
					title: `Luraph - Select Option: ${title}`,
					placeHolder,

					ignoreFocusOut: true,
					canPickMany: false,
					matchOnDetail: true
				});

				if(!selectedValue){
					return;
				}

				optionValues[id] = selectedValue.label;
			}

			for(const { id, title, prompt, placeHolder } of textFields){
				const selectedValue = await vscode.window.showInputBox({
					title: `Luraph - Select Option: ${title}`,
					prompt,
					placeHolder,

					ignoreFocusOut: true
				});

				if(!selectedValue){
					return;
				}

				optionValues[id] = selectedValue;
			}

			statusBarItem.text = "$(gear~spin) Obfuscating...";
			const { jobId } = await luraphApi.createNewJob(nodeId, contents, `[luraph-vscode] ${fileName}`, optionValues);
			
			log(`> Job ID: ${jobId}`);
			statusBarItem.text = `$(gear~spin) Obfuscating... (Job ID: ${jobId})`;

			const status = await luraphApi.getJobStatus(jobId);
			if(!status.success){
				const error = status.error;
				log(`> Obfuscation failed: ${error}`);
				return vscode.window.showErrorMessage(`Obfuscation Error: ${error}`);
			}

			const result = await luraphApi.downloadResult(jobId);
			log(`> Obfuscation succeeded! (${result.data.length} bytes)`);

			let directory = vscode.workspace.workspaceFolders?.[0].uri.path || "";
			let resultName = document.uri.path;
			if(document.uri.scheme === "file" || document.uri.scheme === "untitled"){
				const lastSlash = resultName.lastIndexOf("/");

				if(lastSlash !== -1){
					directory = resultName.substring(0, lastSlash);
					resultName = resultName.substring(lastSlash + 1);
				}
			}

			const filePart = resultName.split(".")[0];
			resultName = `${filePart}-obfuscated.lua`;
			
			let resultUri;
			let tries = 0;
			while(true){
				resultUri = vscode.Uri.from({
					path: `${directory}/${filePart}-obfuscated${tries > 0 ? `-${tries}` : ""}.lua`,
					scheme: "untitled"
				});

				try{
					await vscode.workspace.fs.stat(resultUri.with({ scheme: "file" }));
				}catch(err){
					if(err instanceof vscode.FileSystemError && err.code === "FileNotFound"){
						break; //file doesn't exist, save here
					}

					throw err;
				}

				tries++;
			}

			log(`> Saving to file: ${resultUri.fsPath}`);

			const newDoc = await vscode.workspace.openTextDocument(resultUri);
			const textEditor = await vscode.window.showTextDocument(newDoc);

			const editsApplied = await textEditor.edit((editBuilder) => {
				editBuilder.replace(new vscode.Position(0, 0), result.data);
			});

			if(!editsApplied){
				throw new Error("VS Code Extension Error: Could not apply edits to created TextEditor");
			}
		}catch(err){
			if(err instanceof Error && err.name === "LuraphException"){ //TODO: use instanceof LuraphException
				return vscode.window.showErrorMessage(`Luraph API Error: ${err.message}`);
			}

			throw err;
		}finally{
			statusBarItem.text = "$(terminal) Obfuscate with Luraph";
		}
	});

	context.subscriptions.push(command);
}

export function deactivate() {} //no-op
