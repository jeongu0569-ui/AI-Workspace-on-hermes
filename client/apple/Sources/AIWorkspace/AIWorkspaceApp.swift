import SwiftUI

@main
struct AIWorkspaceApp: App {
    @StateObject private var store = WorkspaceStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .task {
                    await store.refreshWorkspace()
                }
        }
        .windowStyle(.titleBar)
    }
}

