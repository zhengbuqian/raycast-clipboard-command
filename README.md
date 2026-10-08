# Clipboard Command for Raycast

Choose one of the six most recent **text** entries in Raycast's clipboard history, or type a command, and run it in a persistent zsh session. The selected entry is shown in full before you run it. Command output appears in Raycast.

## Install locally

Requires Raycast on macOS and Node.js 22.14 or newer.

```sh
cd ~/Projects/personal/raycast-clipboard-command
npm install
npm run dev
```

`npm run dev` imports the local extension into Raycast. Once the command appears, you can stop the development process; the imported command stays available. Search for **Run Clipboard Command** in Raycast. Select a history item, review its full text on the right, then press Enter or choose **Run as Command** from Command-K. Type a command into the search field to add a **Run Typed Command** item after matching history. Enter runs the selected item; Command-Enter always runs the exact search text, even when a history entry matches. Whitespace-only input cannot run. Output appears in the right-hand detail area while the list stays open. Press Command-A to replace the search text with your next command. The selected item offers **Stop Command** while it is running and **Copy Standard Output** when output is available.

`npm run bundle` creates `dist/clipboard-command.rayext` for packaging.

The project checks source lint and formatting directly. The manifest uses a local author ID for Raycast's extension registration; publishing to the Store would require a Raycast account with that handle.

Raycast's public Clipboard API exposes at most six recent history offsets. Non-text and empty entries are skipped. Commands run in a background `/bin/zsh -l` process, starting in your home directory, with no interactive input. The shell keeps its directory, variables, and environment across commands. The 30-second idle timer begins when a command finishes and resets after each later command. Running commands do not time out. Closing Raycast leaves the shell running; reopening the extension shows its current directory and actual remaining time. Only one command runs at a time. **Stop Command** terminates the current shell session, so the next command starts in a fresh shell. Each output stream is displayed up to 256,000 bytes. Successful commands show their standard output directly; failures include the exit status and diagnostic output.

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run build
```
