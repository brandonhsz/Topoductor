// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "TopoComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "TopoComputerUseMacOSCore",
            targets: ["TopoComputerUseMacOSCore"]
        ),
        .executable(
            name: "topo-computer-use-macos",
            targets: ["TopoComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "TopoComputerUseMacOSCore",
            path: "Sources/TopoComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "TopoComputerUseMacOS",
            dependencies: ["TopoComputerUseMacOSCore"],
            path: "Sources/TopoComputerUseMacOS"
        ),
        .testTarget(
            name: "TopoComputerUseMacOSTests",
            dependencies: ["TopoComputerUseMacOSCore"],
            path: "Tests/TopoComputerUseMacOSTests"
        )
    ]
)
