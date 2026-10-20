// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PaperTodo",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "PaperTodo", targets: ["PaperTodo"])],
    targets: [
        .target(name: "PaperCore"),
        .executableTarget(name: "PaperTodo", dependencies: ["PaperCore"], resources: [.copy("Assets")])
    ]
)
