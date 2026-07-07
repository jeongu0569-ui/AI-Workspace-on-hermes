import SwiftUI

struct FileSectionView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let title: String
    let root: String
    let items: [WorkspaceItem]

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                HeaderView(title: title, subtitle: root)
                List(items) { item in
                    Button {
                        Task { await store.loadFile(item) }
                    } label: {
                        HStack {
                            Image(systemName: icon(for: item))
                                .foregroundStyle(item.isDirectory ? .blue : .secondary)
                            VStack(alignment: .leading) {
                                Text(item.name)
                                Text(item.path)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(minWidth: 280, idealWidth: 340)

            FilePreviewView()
                .frame(minWidth: 480)
        }
    }

    private func icon(for item: WorkspaceItem) -> String {
        if item.isDirectory { return "folder" }
        switch item.kind {
        case "markdown": return "doc.text"
        case "pdf": return "doc.richtext"
        case "image": return "photo"
        case "code": return "curlybraces"
        default: return "doc"
        }
    }
}

struct FilePreviewView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        VStack(spacing: 0) {
            if let file = store.selectedFile {
                HeaderView(title: file.name, subtitle: file.path)
                ScrollView {
                    Text(file.content)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                }
            } else {
                ContentUnavailableView("Select a file", systemImage: "doc.text.magnifyingglass", description: Text("Open a markdown or text file from the tree."))
            }
        }
    }
}

