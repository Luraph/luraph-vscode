import type { LuraphOptionList } from "luraph";
import type { ConfigurationTarget } from "vscode";

export interface IExtensionSettings {
  "API Key": string;
  /**
   * VS Code will fallback to empty `{}` if not set...
   */
  Options: LuraphOptionList | Record<string, never>;
}

declare module "vscode" {
  interface WorkspaceConfiguration {
    get<K extends keyof IExtensionSettings>(
      section: K
    ): IExtensionSettings[K] | undefined;

    update<K extends keyof IExtensionSettings>(
      section: K,
      value: IExtensionSettings[K],
      configurationTarget?: ConfigurationTarget | boolean | null,
      overrideInLanguage?: boolean
    ): Thenable<void>;
  }
}
