import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var selection: WorkspaceSection? = .chat
    @State private var isChatPanelVisible = false

    var body: some View {
        NavigationSplitView {
            List(WorkspaceSection.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.systemImage)
                    .tag(section)
            }
            .navigationTitle("Workspace")
            .safeAreaInset(edge: .bottom) {
                ServerStatusView()
                    .padding(12)
            }
        } detail: {
            detailView
                .toolbar {
                    if selectedSection != .chat {
                        Button {
                            isChatPanelVisible.toggle()
                        } label: {
                            Image(systemName: isChatPanelVisible ? "sidebar.right" : "bubble.right")
                        }
                        .help(isChatPanelVisible ? "Hide chat panel" : "Show chat panel")
                    }
                }
                .sheet(isPresented: chatPanelSheetBinding) {
                    ChatHomeView(compact: true)
                        .environmentObject(store)
                }
        }
    }

    private var selectedSection: WorkspaceSection {
        selection ?? .chat
    }

    private var chatPanelSheetBinding: Binding<Bool> {
        Binding(
            get: {
                #if os(iOS)
                return isChatPanelVisible && selectedSection != .chat
                #else
                return false
                #endif
            },
            set: { value in
                #if os(iOS)
                isChatPanelVisible = value
                #else
                _ = value
                #endif
            }
        )
    }

    @ViewBuilder
    private var detailView: some View {
        #if os(macOS)
        if selectedSection != .chat && isChatPanelVisible {
            HSplitView {
                primaryDetailView
                    .frame(minWidth: 0)
                Divider()
                ChatHomeView(compact: true)
                    .frame(minWidth: 320, idealWidth: 390, maxWidth: 460)
            }
        } else {
            primaryDetailView
        }
        #else
        primaryDetailView
        #endif
    }

    @ViewBuilder
    private var primaryDetailView: some View {
        switch selectedSection {
        case .chat:
            ChatHomeView()
        case .notes:
            FileSectionView(title: "Notes", root: "notes")
        case .code:
            FileSectionView(title: "Code", root: "code")
        case .search:
            SearchView()
        }
    }
}

struct ServerStatusView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Workspace Server", text: $store.serverURLText)
                .textFieldStyle(.roundedBorder)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                #endif
                .onSubmit {
                    store.saveServerURL()
                    Task { await store.refreshWorkspace() }
                }
            Text(store.serverConnectionHint)
                .font(.caption2)
                .foregroundStyle(store.serverURLUsesLocalhost ? .orange : .secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Circle()
                    .fill(store.statusMessage == "Connected" ? .green : .orange)
                    .frame(width: 8, height: 8)
                Text(store.statusMessage)
                    .font(.caption)
                    .lineLimit(2)
                Spacer()
                Button {
                    store.saveServerURL()
                    Task { await store.refreshWorkspace() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
            }
        }
    }
}
