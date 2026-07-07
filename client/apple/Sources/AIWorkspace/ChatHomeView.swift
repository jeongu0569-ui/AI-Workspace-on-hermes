import SwiftUI

struct ChatHomeView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(title: "Hermes Chat", subtitle: store.workspace?.hermes.serverUrl ?? "No Hermes server loaded")
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    MessageBubble(role: "system", text: "Hermes live chat will use WS /api/live. The server bridge is already implemented; this client shell is ready for the next wiring step.")
                    if let workspace = store.workspace {
                        MessageBubble(role: "workspace", text: "Workspace root: \(workspace.rootName)\nSearch: \(workspace.search?.provider ?? "unknown")")
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack(spacing: 12) {
                TextField("Message Hermes...", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .padding(10)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                Button {
                    draft = ""
                } label: {
                    Image(systemName: "paperplane.fill")
                }
                .buttonStyle(.borderless)
                .font(.title3)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(16)
        }
    }
}

struct MessageBubble: View {
    let role: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(role.uppercased())
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(text)
                .textSelection(.enabled)
        }
        .padding(12)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
    }
}

