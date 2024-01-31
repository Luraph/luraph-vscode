# Features planned to be added in the near future (contributions to add these features are appreciated and *encouraged!*):

- Allow settings to be saved for reuse next obfuscation, or to allow presets to be used for faster obfuscations.
- Add button to `editor/title` menu, and the right click file context menu if possible (https://code.visualstudio.com/api/references/contribution-points#contributes.menus)
- Allow obfuscation to be ran as a VS Code task
- Display `Success!` or `Failed!` on status bar for 3 seconds after a job succeeds/fails.
- Prevent concurrent obfuscations or ensure that the UI is synchronized.
- Allow obfuscation of a selected area of text instead of an entire file.
- Possibly allow obfuscation to be inlined in the same file, or as a in-place replacement of the current file.
- Embed an additional button (`QuickInputButton`) in the nodes list to `show` with a list of each node's settings. Either display to an outputchannel and focus it, or use showInformationMessage.
- Add extension tests to ensure that updates don't break functionality.
- Cleanup code and split into multiple functions.
- Add telemetry to count obfuscation usages to determine extension usage.
- Bundle extension (https://code.visualstudio.com/api/working-with-extensions/bundling-extension)