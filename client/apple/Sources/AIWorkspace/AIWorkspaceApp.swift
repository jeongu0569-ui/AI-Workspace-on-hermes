import SwiftUI
#if os(macOS)
import AppKit
#endif

@main
struct AIWorkspaceApp: App {
    @StateObject private var store = WorkspaceStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                #if os(macOS)
                .onAppear {
                    activateMacAppWindow()
                }
                #endif
                .task {
                    await store.refreshWorkspace()
                }
        }
        .windowStyle(.titleBar)
    }
}

#if os(macOS)
@MainActor
private func activateMacAppWindow() {
    NSApp.setActivationPolicy(.regular)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        NSApp.windows.first?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
#endif
