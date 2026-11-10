/// Bundle ids of the apps whose computer-use sidecar may drive this helper.
public enum TrustedTopoApplication {
    public static func isTrusted(bundleId: String) -> Bool {
        // Why: `pnpm dev` launches as `com.brandonhsz.topo.dev` and per-worktree wrapper apps use
        // `com.brandonhsz.topo.dev.<name>`; the sidecar peer check must authorize both (#26498).
        bundleId == "com.brandonhsz.topo" ||
            bundleId == "com.brandonhsz.topo.dev" ||
            bundleId.hasPrefix("com.brandonhsz.topo.dev.") ||
            bundleId == "com.github.Electron"
    }
}
