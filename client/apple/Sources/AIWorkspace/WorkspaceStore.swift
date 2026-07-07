import Foundation

@MainActor
final class WorkspaceStore: ObservableObject {
    @Published var serverURLText = UserDefaults.standard.string(forKey: "workspace.serverURL") ?? "http://127.0.0.1:8787"
    @Published var workspace: WorkspaceInfo?
    @Published var notes: [WorkspaceItem] = []
    @Published var code: [WorkspaceItem] = []
    @Published var selectedFile: FileResponse?
    @Published var searchResponse: SearchResponse?
    @Published var statusMessage = "Not connected"
    @Published var isLoading = false

    var api: WorkspaceAPI? {
        guard let url = URL(string: serverURLText) else { return nil }
        return WorkspaceAPI(baseURL: url)
    }

    func saveServerURL() {
        UserDefaults.standard.set(serverURLText, forKey: "workspace.serverURL")
    }

    func refreshWorkspace() async {
        guard let api else {
            statusMessage = "Invalid server URL"
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            workspace = try await api.workspace()
            notes = try await api.tree(root: "notes").children
            code = try await api.tree(root: "code").children
            statusMessage = "Connected"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func loadFile(_ item: WorkspaceItem) async {
        guard !item.isDirectory, let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            selectedFile = try await api.file(path: item.path)
            statusMessage = "Opened \(item.name)"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func runSearch(query: String, scopePath: String) async {
        guard let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            searchResponse = try await api.search(query: query, scopePath: scopePath)
            statusMessage = "\(searchResponse?.resultCount ?? 0) results"
        } catch {
            statusMessage = error.localizedDescription
        }
    }
}

