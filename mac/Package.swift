// swift-tools-version: 6.0
import PackageDescription

// #182: `scripts/build.sh` builds the release app with PAPERTODO_APP_BUNDLE=1. The app reads its pictures and fonts from
// Contents/Resources/Assets (build.sh copies them there; AppResources.swift), so SwiftPM makes no resource bundle and
// its generated `Bundle.module` accessor — which writes the absolute build folder into the binary — isn't compiled in.
// Every other build (`swift build`, the test scripts, the snapshot renderer) keeps the resource bundle.
let appBundle = Context.environment["PAPERTODO_APP_BUNDLE"] == "1"

let package = Package(
    name: "PaperTodo",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "PaperTodo", targets: ["PaperTodo"])],
    targets: [
        .target(name: "PaperCore"),
        .executableTarget(
            name: "PaperTodo",
            dependencies: ["PaperCore"],
            exclude: appBundle ? ["Assets"] : [],
            resources: appBundle ? [] : [.copy("Assets")],
            swiftSettings: appBundle ? [.define("PAPERTODO_APP_BUNDLE")] : []
        )
    ]
)
