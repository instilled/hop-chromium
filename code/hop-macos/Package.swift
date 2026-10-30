// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "Hop",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Hop", targets: ["Hop"]),
        .executable(name: "hop-cli", targets: ["hop-cli"]),
    ],
    targets: [
        .target(name: "HopCore"),
        .executableTarget(name: "Hop", dependencies: ["HopCore"]),
        .executableTarget(name: "hop-cli", dependencies: ["HopCore"]),
        .testTarget(name: "HopCoreTests", dependencies: ["HopCore"]),
    ]
)
