import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var query = ""
    @State private var scopePath = "Notes"

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(title: "Search", subtitle: store.workspace?.search?.description ?? "Workspace search")
            HStack(spacing: 10) {
                TextField("Search query", text: $query)
                    .textFieldStyle(.roundedBorder)
                TextField("Scope", text: $scopePath)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 220)
                Button("Search") {
                    Task { await store.runSearch(query: query, scopePath: scopePath) }
                }
                .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(16)
            Divider()
            List(store.searchResponse?.results ?? []) { result in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(result.path)
                            .font(.headline)
                        Spacer()
                        Text(result.kind)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text(result.snippet)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 6)
            }
        }
    }
}

