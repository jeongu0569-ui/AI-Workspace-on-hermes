// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AIWorkspaceApple",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "AIWorkspace", targets: ["AIWorkspace"])
    ],
    targets: [
        .executableTarget(
            name: "AIWorkspace",
            path: "Sources/AIWorkspace"
        )
    ]
)

