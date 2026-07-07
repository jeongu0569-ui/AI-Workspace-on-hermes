# Apple Client

The first Apple client is a macOS SwiftUI shell in:

```text
client/apple
```

It is intentionally a Swift Package first, not a full Xcode project. This keeps
the scaffold buildable on machines that only have Command Line Tools installed.

## Run

Start the Workspace Server first:

```bash
npm start
```

Then run the client:

```bash
cd client/apple
swift run AIWorkspace
```

## Current Views

```text
Chat
Notes
Code
Search
```

Implemented:

- server URL setting
- workspace status loading
- Notes root listing
- Code root listing
- text/markdown file preview
- workspace search UI

Not yet implemented:

- recursive folder navigation
- markdown editing and save
- PDF rendering
- Hermes live chat via `/api/live`
- iOS target packaging

## Client API Boundary

The app talks only to the Workspace Server:

```text
GET  /api/workspace
GET  /api/tree
GET  /api/file
POST /api/search
WS   /api/live
```

It should not directly access filesystem paths or Hermes dashboard cookies.

